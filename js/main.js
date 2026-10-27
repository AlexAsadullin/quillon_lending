(() => {
  'use strict';

  const config = window.APP_CONFIG || {};
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /* ---------- Шапка: фон появляется после начала прокрутки ---------- */

  function initHeader() {
    const header = $('[data-js="header"]');
    if (!header) return;

    const update = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  /* ---------- Мобильное меню ---------- */

  function initBurger() {
    const burger = $('[data-js="burger"]');
    const nav = $('[data-js="nav"]');
    if (!burger || !nav) return;

    const setOpen = (isOpen) => {
      burger.setAttribute('aria-expanded', String(isOpen));
      nav.classList.toggle('is-open', isOpen);
    };

    burger.addEventListener('click', () => {
      setOpen(burger.getAttribute('aria-expanded') !== 'true');
    });

    // Закрываем меню после перехода по якорю
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        burger.focus();
      }
    });
  }

  /* ---------- Шестерёнки, вращающиеся от прокрутки ---------- */

  function initScrollGears() {
    const gears = $$('[data-js="scroll-gear"]');
    if (!gears.length || reducedMotion.matches) return;

    let ticking = false;

    const render = () => {
      const y = window.scrollY;
      gears.forEach((gear) => {
        const speed = Number(gear.dataset.speed) || 0;
        gear.style.setProperty('--rot', `${(y * speed).toFixed(2)}deg`);
      });
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(render);
    }, { passive: true });
  }

  /* ---------- Появление блоков при прокрутке ---------- */

  function initReveal() {
    const items = $$('[data-js="reveal"]');
    if (!items.length || reducedMotion.matches || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px' });

    items.forEach((item, index) => {
      item.classList.add('reveal');
      // Лёгкая «лесенка» внутри одной группы
      item.style.transitionDelay = `${(index % 4) * 80}ms`;
      observer.observe(item);
    });
  }

  /* ---------- Год в подвале ---------- */

  function initYear() {
    const year = $('[data-js="year"]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  /* ---------- Источник заявки: utm_source из ссылки ---------- */

  // Метку запоминаем на сессию: клиент приходит по рекламе на главную, а заявку оставляет на /zapis/
  const UTM_KEY = 'shesterenka:utmSource';
  const DEFAULT_SOURCE = 'web';
  const cleanSource = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);

  function initUtm() {
    const source = cleanSource(new URLSearchParams(window.location.search).get('utm_source'));
    if (!source) return;
    try {
      window.sessionStorage.setItem(UTM_KEY, source);
    } catch {
      /* хранилище недоступно — метка учтётся, только если заявку оставят на этой же странице */
    }
  }

  function leadSource() {
    const fromUrl = cleanSource(new URLSearchParams(window.location.search).get('utm_source'));
    if (fromUrl) return fromUrl;
    try {
      return cleanSource(window.sessionStorage.getItem(UTM_KEY)) || DEFAULT_SOURCE;
    } catch {
      return DEFAULT_SOURCE;
    }
  }

  /* ---------- Капча Cloudflare Turnstile ---------- */

  // Скрипт грузим только там, где капча нужна: в форме — при заданном ключе, и на демо-странице
  const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const NO_CAPTCHA = { enabled: false, response: () => '', failed: () => false, reset() {} };
  let turnstileLoading = null;

  function loadTurnstile() {
    turnstileLoading = turnstileLoading || new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SRC;
      script.async = true;
      script.addEventListener('load', () => resolve(window.turnstile));
      script.addEventListener('error', reject);
      document.head.append(script);
    });
    return turnstileLoading;
  }

  function initCaptcha(form) {
    const box = $('[data-js="captcha"]', form);
    const siteKey = config.TURNSTILE_SITE_KEY;
    if (!box || !siteKey) return NO_CAPTCHA;

    const state = { response: '', failed: false, widgetId: null };
    const render = (turnstile) => {
      state.widgetId = turnstile.render(box, {
        sitekey: siteKey,
        language: 'ru',
        theme: 'light',
        callback: (response) => Object.assign(state, { response, failed: false }),
        'expired-callback': () => { state.response = ''; },
        'error-callback': () => Object.assign(state, { response: '', failed: true }),
      });
    };

    box.hidden = false;
    loadTurnstile().then(render).catch(() => { state.failed = true; });

    return {
      enabled: true,
      response: () => state.response,
      failed: () => state.failed,
      // Ответ капчи одноразовый: после любой отправки нужен новый
      reset() {
        state.response = '';
        if (state.widgetId !== null && window.turnstile) window.turnstile.reset(state.widgetId);
      },
    };
  }

  /* ---------- Демо-страница капчи /captcha/ ---------- */

  // Тестовые ключи Cloudflare: публичные, работают на любом домене, настоящей проверки не делают
  const CAPTCHA_DEMO = {
    interactive: {
      siteKey: '3x00000000000000000000FF',
      hint: 'Посетитель отмечает галочку — так проверка выглядит чаще всего.',
    },
    pass: {
      siteKey: '1x00000000000000000000AA',
      hint: 'Cloudflare узнаёт человека без действий с его стороны: виджет сразу показывает «Успешно».',
    },
    block: {
      siteKey: '2x00000000000000000000AB',
      hint: 'Cloudflare принимает посетителя за бота — так проверку увидит программа для рассылки спама.',
    },
  };

  function initCaptchaDemo() {
    const demo = $('[data-js="captcha-demo"]');
    if (!demo) return;

    const box = $('[data-js="captcha-widget"]', demo);
    const hint = $('[data-js="captcha-hint"]', demo);
    const status = $('[data-js="captcha-status"]', demo);
    const buttons = $$('[data-js="captcha-mode"]', demo);
    let widgetId = null;

    const show = async (mode) => {
      buttons.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('btn--ghost-dark', !active);
      });
      hint.textContent = CAPTCHA_DEMO[mode].hint;
      setStatus(status, '', null);
      try {
        const turnstile = await loadTurnstile();
        if (widgetId !== null) turnstile.remove(widgetId);
        widgetId = turnstile.render(box, {
          sitekey: CAPTCHA_DEMO[mode].siteKey,
          language: 'ru',
          theme: 'light',
          callback: () => setStatus(status, 'Проверка пройдена — форма отправила бы заявку.', 'success'),
          'expired-callback': () => setStatus(status, 'Время проверки вышло — её нужно пройти заново.', 'error'),
          'error-callback': () => setStatus(status, 'Проверка не пройдена — заявка не отправится.', 'error'),
        });
      } catch {
        setStatus(status, 'Не удалось загрузить капчу Cloudflare: проверьте интернет или блокировщик рекламы.', 'error');
      }
    };

    buttons.forEach((button) => button.addEventListener('click', () => show(button.dataset.mode)));
    show('interactive');
  }

  /* ---------- Телефон: маска и проверка ---------- */

  // Возвращает 10 цифр номера без кода страны (+7 / 8)
  function phoneDigits(value) {
    let digits = value.replace(/\D/g, '');
    if (/^[78]/.test(digits)) digits = digits.slice(1);
    return digits.slice(0, 10);
  }

  // Формат +7 (XXX) XXX-XX-XX. Разделители добавляются только перед следующей цифрой,
  // поэтому Backspace работает естественно.
  function formatPhone(value) {
    const d = phoneDigits(value);
    if (!d) return '';

    let out = `+7 (${d.slice(0, 3)}`;
    if (d.length > 3) out += `) ${d.slice(3, 6)}`;
    if (d.length > 6) out += `-${d.slice(6, 8)}`;
    if (d.length > 8) out += `-${d.slice(8, 10)}`;
    return out;
  }

  function initPhoneMask() {
    const input = $('[data-js="phone"]');
    if (!input) return;

    input.addEventListener('input', () => {
      input.value = formatPhone(input.value);
    });
  }

  /* ---------- Запись: день и время визита ----------
     Слоты считаются по московскому времени, где бы ни находился посетитель.
     Это предварительная запись — занятость постов не проверяется, время подтверждает мастер. */

  const TIME_ZONE = 'Europe/Moscow';
  const MIN_LEAD_MINUTES = 60;

  function moscowNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    return { year: get('year'), month: get('month'), day: get('day'), minutes: get('hour') * 60 + get('minute') };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dayLabel = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' });

  // Часы записи в выбранный день — по режиму работы; последний слот за час до закрытия.
  // Сегодня — только с запасом от текущего времени
  function slotsFor(dayOffset, hours, now) {
    const slots = [];
    if (!hours) return slots;
    const [open, close] = hours;
    for (let hour = open; hour < close; hour += 1) {
      if (dayOffset > 0 || hour * 60 >= now.minutes + MIN_LEAD_MINUTES) slots.push(`${pad(hour)}:00`);
    }
    return slots;
  }

  function bookingDays(daysAhead, schedule) {
    const now = moscowNow();
    const days = [];
    for (let offset = 0; offset <= daysAhead; offset += 1) {
      const date = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
      const slots = slotsFor(offset, schedule[date.getUTCDay()], now);
      if (slots.length) {
        const prefix = ['Сегодня, ', 'Завтра, '][offset] || '';
        days.push({ value: date.toISOString().slice(0, 10), label: prefix + dayLabel.format(date), slots });
      }
    }
    return days;
  }

  function fillSelect(select, options, placeholder) {
    select.replaceChildren(new Option(placeholder, ''));
    options.forEach(({ value, label }) => select.add(new Option(label, value)));
  }

  // Возвращает функцию сброса — нужна после отправки формы
  function initBooking(form) {
    const dateSelect = $('[data-js="visit-date"]', form);
    const timeSelect = $('[data-js="visit-time"]', form);
    if (!dateSelect || !timeSelect) return () => {};

    const daysAhead = Number(form.dataset.bookingDays) || 14;
    let schedule = {};
    try {
      schedule = JSON.parse(form.dataset.bookingSchedule || '{}');
    } catch {
      console.warn('[Шестерёнка] Режим работы для записи не прочитан — выбор дня отключён.');
    }
    let days = [];

    const syncTime = () => {
      const day = days.find(({ value }) => value === dateSelect.value);
      fillSelect(timeSelect, day ? day.slots.map((slot) => ({ value: slot, label: slot })) : [], 'Любое время');
      timeSelect.disabled = !day;
    };

    const reset = () => {
      days = bookingDays(daysAhead, schedule);
      fillSelect(dateSelect, days, 'Любой день');
      syncTime();
    };

    dateSelect.addEventListener('change', syncTime);
    reset();
    return reset;
  }

  /* ---------- Форма записи ---------- */

  // Кнопка «Записаться» на услуге ведёт на /zapis/?usluga=<slug> — выбираем эту услугу в форме
  function preselectService(form) {
    const slug = new URLSearchParams(window.location.search).get('usluga');
    if (!slug) return;
    const option = Array.from(form.elements.service.options).find((o) => o.dataset.slug === slug);
    if (!option) return;
    option.defaultSelected = true;
    option.selected = true;
  }

  const STORAGE_KEY = 'shesterenka:lastSentAt';

  // sessionStorage может быть недоступен (приватный режим) — тогда помним в памяти
  const lastSent = {
    memory: 0,
    get() {
      try {
        return Number(window.sessionStorage.getItem(STORAGE_KEY)) || this.memory;
      } catch {
        return this.memory;
      }
    },
    set(time) {
      this.memory = time;
      try {
        window.sessionStorage.setItem(STORAGE_KEY, String(time));
      } catch {
        /* хранилище недоступно — достаточно значения в памяти */
      }
    },
  };

  const validators = {
    name(value) {
      if (!value) return 'Укажите имя';
      if (value.length < 2) return 'Слишком короткое имя';
      if (!/^[\p{L}\s'-]+$/u.test(value)) return 'Только буквы, пробел и дефис';
      return '';
    },
    phone(value) {
      if (!value) return 'Укажите телефон';
      if (phoneDigits(value).length !== 10) return 'Номер должен содержать 10 цифр после +7';
      return '';
    },
    consent(checked) {
      return checked ? '' : 'Нужно согласие на обработку данных';
    },
  };

  function setFieldError(input, message) {
    const error = document.getElementById(input.getAttribute('aria-describedby'));
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    if (error) error.textContent = message;
  }

  function validateForm(form) {
    const fields = {
      name: form.elements.name,
      phone: form.elements.phone,
      consent: form.elements.consent,
    };

    let firstInvalid = null;
    Object.entries(fields).forEach(([key, input]) => {
      const value = input.type === 'checkbox' ? input.checked : input.value.trim();
      const message = validators[key](value);
      setFieldError(input, message);
      if (message && !firstInvalid) firstInvalid = input;
    });

    return firstInvalid;
  }

  function setStatus(statusEl, message, type) {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', type === 'error');
    statusEl.classList.toggle('is-success', type === 'success');
  }

  function isLocalPreview() {
    const { protocol, hostname } = window.location;
    return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1';
  }

  async function sendLead(payload) {
    const endpoint = config.FORM_ENDPOINT;

    if (!endpoint) {
      if (isLocalPreview()) {
        console.warn('[Шестерёнка] FORM_ENDPOINT не задан — демо-режим, заявка никуда не отправлена.');
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        return;
      }
      throw new Error('not-configured');
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS || 10000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: 'omit',
      });
      // 403 — сервер не принял капчу
      if (response.status === 403) throw new Error('captcha');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } finally {
      window.clearTimeout(timer);
    }
  }

  function makeTicketNumber() {
    const random = new Uint16Array(1);
    window.crypto.getRandomValues(random);
    const now = new Date();
    const datePart = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `№ ${datePart}-${String(random[0] % 10000).padStart(4, '0')}`;
  }

  function initCallbackForm() {
    const form = $('[data-js="callback-form"]');
    if (!form) return;

    const submit = $('[data-js="submit"]', form);
    const status = $('[data-js="status"]', form);
    const ticketNumber = $('[data-js="ticket-number"]', form);
    // Телефон показываем, только если он есть на странице (в content/ может быть «[уточнить у владельца]»)
    const phoneLink = $('[data-js="phone-link"]');
    const callUs = phoneLink ? ` Позвоните нам: ${phoneLink.textContent.trim()}` : '';
    const resetBooking = initBooking(form);
    const captcha = initCaptcha(form);
    preselectService(form);
    const resendDelay = config.RESEND_DELAY_MS || 60000;

    if (ticketNumber) ticketNumber.textContent = makeTicketNumber();

    // Ошибку у поля убираем, как только пользователь начал её исправлять
    // Новый ввод после отправки — снимаем штамп и старый статус
    form.addEventListener('input', (event) => {
      const input = event.target;
      if (input.classList.contains('is-invalid')) setFieldError(input, '');
      if (form.classList.contains('is-sent')) {
        form.classList.remove('is-sent');
        setStatus(status, '', null);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus(status, '', null);

      // Бот заполнил скрытое поле — делаем вид, что всё хорошо, но ничего не отправляем
      if (form.elements.website.value) {
        form.classList.add('is-sent');
        return;
      }

      const firstInvalid = validateForm(form);
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const waitMs = lastSent.get() + resendDelay - Date.now();
      if (waitMs > 0) {
        setStatus(status, `Заявка уже отправлена. Повторить можно через ${Math.ceil(waitMs / 1000)} с.`, 'error');
        return;
      }

      if (captcha.enabled && !captcha.response()) {
        const reason = captcha.failed()
          ? `Проверка «я не робот» не прошла. Обновите страницу и попробуйте снова.${callUs}`
          : 'Подтвердите, что вы не робот: отметьте проверку в форме.';
        setStatus(status, reason, 'error');
        return;
      }

      const payload = {
        name: form.elements.name.value.trim(),
        phone: `+7${phoneDigits(form.elements.phone.value)}`,
        car: form.elements.car.value.trim(),
        problem: form.elements.problem.value.trim(),
        service: form.elements.service.value,
        visitDate: form.elements.visitDate.value,
        visitTime: form.elements.visitTime.value,
        consent: true,
        source: leadSource(),
        captchaToken: captcha.response(),
        page: window.location.href,
        sentAt: new Date().toISOString(),
      };

      submit.disabled = true;
      submit.textContent = 'Отправляем…';

      try {
        await sendLead(payload);
        lastSent.set(Date.now());
        form.classList.add('is-sent');
        form.reset();
        resetBooking();
        setStatus(status, 'Заявка принята. Перезвоним и согласуем время визита.', 'success');
      } catch (error) {
        const reasons = {
          'not-configured': 'Онлайн-заявки временно не принимаются.',
          captcha: 'Проверка «я не робот» не пройдена. Отметьте поле ещё раз и отправьте заявку.',
        };
        const reason = reasons[error.message] || 'Не удалось отправить заявку. Попробуйте ещё раз.';
        setStatus(status, reason + callUs, 'error');
      } finally {
        captcha.reset();
        submit.disabled = false;
        submit.textContent = 'Записаться';
      }
    });
  }

  initHeader();
  initBurger();
  initScrollGears();
  initReveal();
  initYear();
  initUtm();
  initPhoneMask();
  initCallbackForm();
  initCaptchaDemo();
})();
