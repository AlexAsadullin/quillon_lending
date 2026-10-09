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

  /* ---------- Форма «Заказать звонок» ---------- */

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
    const phone = config.PHONE_DISPLAY || '';
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

      const payload = {
        name: form.elements.name.value.trim(),
        phone: `+7${phoneDigits(form.elements.phone.value)}`,
        car: form.elements.car.value.trim(),
        problem: form.elements.problem.value.trim(),
        consent: true,
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
        setStatus(status, 'Заявка принята. Мастер перезвонит в течение 15 минут в рабочее время.', 'success');
      } catch (error) {
        const reason = error.message === 'not-configured'
          ? 'Онлайн-заявки временно не принимаются.'
          : 'Не удалось отправить заявку.';
        setStatus(status, `${reason} Позвоните нам: ${phone}`, 'error');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Жду звонка';
      }
    });
  }

  initHeader();
  initBurger();
  initScrollGears();
  initReveal();
  initYear();
  initPhoneMask();
  initCallbackForm();
})();
