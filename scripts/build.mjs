// Сборка сайта: content/ + templates/ → dist/.
// Только встроенные модули Node — без npm и зависимостей.
// Запуск: node scripts/build.mjs

import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// Публикуется только это. content/docs и служебные файлы в dist не попадают никогда
const STATIC_DIRS = ['css', 'js', 'assets'];
const PLACEHOLDER = '[уточнить у владельца]';

/* ---------- Карта сайта: единственный список страниц ----------
   Из него строятся меню в шапке и подвале и sitemap.xml (правило 5 в CLAUDE.md).
   nav — подпись в меню; страницы услуг добавляются из content/services автоматически. */
const PAGES = [
  { path: '', template: 'index' },
  { path: 'uslugi/', template: 'services', nav: 'Услуги' },
  { path: 'ceny/', template: 'prices', nav: 'Цены' },
  { path: 'garantiya-i-oplata/', template: 'terms', nav: 'Гарантия и оплата' },
  { path: 'voprosy/', template: 'faq', nav: 'Вопросы' },
  { path: 'akcii-predlozheniya/', template: 'akcii_predlozheniya', nav: 'Акции' },
  { path: 'zapis/', template: 'booking', nav: 'Запись', cta: true },
  { path: 'privacy.html', template: 'privacy', noindex: true, solidHeader: true },
  { path: '404.html', template: '404', noindex: true, root: '/' },
];

class BuildError extends Error {}
const fail = (message) => {
  throw new BuildError(message);
};

const readText = (rel) => readFile(path.join(ROOT, rel), 'utf8');

async function readJson(rel) {
  try {
    return JSON.parse(await readText(rel));
  } catch (error) {
    return fail(`${rel}: ${error.message}`);
  }
}

const get = (obj, key) => key.split('.').reduce((o, part) => (o == null ? undefined : o[part]), obj);
const isPlaceholder = (value) => String(value).includes('[уточнить');

/* ---------- Шаблонизатор ----------
   {{path}} — значение с экранированием, {{{path}}} — готовый HTML,
   {{> partial}} — общая часть, {{#each list}}…{{/each}} и {{#if path}}…{{/if}} — без вложенности.
   Внутри each текущий элемент доступен как {{it}}. */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

const VAR_RE = /{{{([\w.]+)}}}|{{([\w.]+)}}/g;

function lookup(ctx, key, name) {
  const value = get(ctx, key);
  if (value === undefined || value === null) fail(`${name}: нет значения для {{${key}}}`);
  return value;
}

function render(template, ctx, name, partials) {
  let out = template.replace(/{{>\s*([\w-]+)\s*}}/g, (_, partial) => {
    if (!(partial in partials)) fail(`${name}: нет общей части «${partial}»`);
    return partials[partial];
  });

  out = out.replace(/{{#each ([\w.]+)}}([\s\S]*?){{\/each}}/g, (_, key, inner) => {
    const list = lookup(ctx, key, name);
    if (!Array.isArray(list)) fail(`${name}: {{#each ${key}}} ожидает список`);
    return list.map((it) => render(inner, { ...ctx, it }, name, partials)).join('');
  });

  out = out.replace(/{{#if ([\w.]+)}}([\s\S]*?){{\/if}}/g, (_, key, inner) => (get(ctx, key) ? inner : ''));

  const leftover = out.replace(VAR_RE, '').match(/{{[^}]*}}/);
  if (leftover) fail(`${name}: непонятный тег ${leftover[0]}`);

  // Одним проходом, чтобы вставленные значения не разбирались повторно как шаблон
  return out.replace(VAR_RE, (_, raw, escaped) => (raw
    ? String(lookup(ctx, raw, name))
    : escapeHtml(lookup(ctx, escaped, name))));
}

/* ---------- Факты ---------- */

function requireFields(obj, fields, source) {
  fields.forEach((field) => {
    const value = get(obj, field);
    if (value === undefined || value === null || value === '') fail(`${source}: не заполнено поле «${field}»`);
  });
}

const formatPrice = (rub) => `${new Intl.NumberFormat('ru-RU').format(rub)} ₽`;

async function loadPrices() {
  const source = 'content/prices.json';
  const prices = await readJson(source);
  const byPoint = new Map();
  [...(prices.items || []), ...(prices.conditions || [])].forEach((entry) => {
    if (!Number.isInteger(entry.point)) fail(`${source}: у позиции нет номера пункта`);
    if (byPoint.has(entry.point)) fail(`${source}: пункт ${entry.point} повторяется`);
    byPoint.set(entry.point, entry);
  });
  prices.items.forEach((item) => {
    requireFields(item, ['name', 'price'], `${source} п. ${item.point}`);
    if (!Number.isInteger(item.price) || item.price <= 0) fail(`${source} п. ${item.point}: цена — целое число рублей`);
  });
  prices.conditions.forEach((c) => requireFields(c, ['value', 'text'], `${source} п. ${c.point}`));
  return { ...prices, byPoint };
}

// Подстановки в текстах content: {price.7}, {cond.13}, {condText.14}, {terms.guarantee.works}.
// Так цифра хранится в одном месте и не расходится между страницами
function makeSubstitute(prices, terms) {
  const entry = (point, field) => {
    const value = prices.byPoint.get(Number(point))?.[field];
    return value ?? fail(`content: нет данных п. ${point} в content/prices.json`);
  };
  const resolvers = {
    price: (point) => formatPrice(entry(point, 'price')),
    cond: (point) => entry(point, 'value'),
    condText: (point) => entry(point, 'text'),
    terms: (key) => get(terms, key) ?? fail(`content: нет terms.${key} в content/terms.json`),
  };
  const substitute = (value) => {
    if (typeof value === 'string') {
      return value
        .replace(/{(price|cond|condText|terms)\.([\w.]+)}/g, (_, kind, key) => resolvers[kind](key))
        // «п. 12» не разрываем переносом строки
        .replace(/п\. (?=\d)/g, 'п.\u00a0');
    }
    if (Array.isArray(value)) return value.map(substitute);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v)]));
    }
    return value;
  };
  return substitute;
}

// Правило 2 и цены без «от»: такие формулировки в content не пропускаем
const FORBIDDEN = [
  [/(^|[\s(«])от\s+\d/i, 'цена «от …» — указывайте цену работы из прайса'],
  [/под ключ/i, '«под ключ»'],
  [/отзыв/i, 'отзывы'],
  [/опыт|лет на рынке/i, '«опыт», «N лет на рынке»'],
  [/\d+\s*(мин(ут|\.)?|час|дн(я|ей)|недел)/i, 'сроки выполнения работ'],
];

function checkForbidden(value, source) {
  if (typeof value === 'string') {
    FORBIDDEN.forEach(([re, label]) => {
      if (re.test(value)) fail(`${source}: запрещено (${label}): «${value}»`);
    });
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, v]) => {
      if (!key.startsWith('_')) checkForbidden(v, source);
    });
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Режим работы — один источник для текста часов, слотов записи и микроразметки
function parseSchedule(rows, source) {
  if (!Array.isArray(rows) || !rows.length) fail(`${source}: не заполнен режим работы (schedule)`);
  const covered = new Set();
  const slots = {};
  rows.forEach((row) => {
    requireFields(row, ['label', 'weekdays'], source);
    row.weekdays.forEach((day) => {
      if (!Number.isInteger(day) || day < 0 || day > 6) fail(`${source}: день недели ${day} — от 0 (вс) до 6 (сб)`);
      if (covered.has(day)) fail(`${source}: день недели ${day} описан дважды`);
      covered.add(day);
    });
    if (row.closed) return;
    const hour = (time) => {
      const match = /^(\d{2}):00$/.exec(time || '');
      return match ? Number(match[1]) : fail(`${source}: время «${time}» — в формате ЧЧ:00`);
    };
    const [open, close] = [hour(row.open), hour(row.close)];
    if (open >= close) fail(`${source}: у «${row.label}» открытие позже закрытия`);
    row.weekdays.forEach((day) => { slots[day] = [open, close]; });
  });
  if (covered.size !== 7) fail(`${source}: в режиме работы описаны не все 7 дней недели`);

  return {
    text: rows.map((r) => (r.closed ? `${r.label} — выходной` : `${r.label} ${r.open}–${r.close}`)).join(', '),
    slots,
    ld: rows.filter((r) => !r.closed).map((r) => ({
      '@type': 'OpeningHoursSpecification', dayOfWeek: r.weekdays.map((d) => WEEKDAYS[d]), opens: r.open, closes: r.close,
    })),
  };
}

async function loadSite() {
  const source = 'content/site.json';
  const site = await readJson(source);
  requireFields(site, ['name', 'legalName', 'url', 'city', 'phone.display', 'address.full', 'booking.daysAhead',
    'operator.name', 'operator.inn', 'operator.ogrn', 'operator.address'], source);
  if (site.phone.tel && !/^\+7\d{10}$/.test(site.phone.tel)) fail(`${source}: phone.tel — в формате +7XXXXXXXXXX`);
  if (site.url.endsWith('/')) fail(`${source}: url указывается без «/» в конце`);
  const schedule = parseSchedule(site.schedule, source);

  const { tel } = site.phone;
  // Телефон не должен переноситься по строкам; неизвестный телефон — текстом, без ссылки
  const display = escapeHtml(site.phone.display).replace(/ /g, '&nbsp;').replace(/-/g, '&#8209;');
  return {
    ...site,
    hours: { text: schedule.text, ld: schedule.ld },
    // Для формы записи: { день недели: [час открытия, час закрытия] }
    bookingSchedule: JSON.stringify(schedule.slots),
    phoneInline: tel ? `<a href="tel:${escapeHtml(tel)}" data-js="phone-link">${display}</a>` : escapeHtml(PLACEHOLDER),
    phoneNav: tel ? `<a class="nav__phone" href="tel:${escapeHtml(tel)}">${display}</a>` : '',
  };
}

async function loadServices(prices, site) {
  const dir = 'content/services';
  const files = (await readdir(path.join(ROOT, dir))).filter((file) => file.endsWith('.json'));
  if (!files.length) fail(`${dir}: нет ни одной услуги`);

  const services = await Promise.all(files.map(async (file) => {
    const source = `${dir}/${file}`;
    const service = await readJson(source);
    requireFields(service, ['slug', 'order', 'title', 'heading', 'points', 'conditions', 'cta'], source);
    if (!/^[a-z0-9-]+$/.test(service.slug)) fail(`${source}: slug — только латиница, цифры и дефис`);
    if (![12, 13].every((p) => service.conditions.includes(p))) fail(`${source}: условия п. 12 и 13 обязательны`);

    const items = service.points.map((point) => {
      const item = prices.byPoint.get(point);
      if (!item || !('price' in item)) fail(`${source}: в прайсе нет работы п. ${point}`);
      return { name: item.name, priceText: formatPrice(item.price), point };
    });
    const conditions = service.conditions.map((point) => {
      const c = prices.byPoint.get(point);
      if (!c || !('text' in c)) fail(`${source}: в прайсе нет условия п. ${point}`);
      return { text: c.text, point };
    });

    // title и description — из фактуры, без ручного дублирования цен
    const seoTitle = items.length === 1
      ? `${service.heading} — ${items[0].priceText}, запчасти отдельно — ${site.name}`
      : `${service.heading}: цены по прайсу — ${site.name}`;
    const seoDescription = `${items.map((i) => `${i.name} — ${i.priceText}`).join('; ')}. `
      + `Запчасти отдельно, срочная работа ${prices.byPoint.get(13).value}. Автосервис «${site.name}», ${site.city}.`;

    return { ...service, items, conditions, seo: { title: seoTitle, description: seoDescription } };
  }));

  // Каждая работа прайса — ровно в одной услуге
  const owner = new Map();
  services.forEach((s) => s.points.forEach((point) => {
    if (owner.has(point)) fail(`content/services: п. ${point} есть и в «${owner.get(point)}», и в «${s.title}»`);
    owner.set(point, s.title);
  }));
  prices.items.forEach(({ point }) => {
    if (!owner.has(point)) fail(`content/prices.json: работа п. ${point} не привязана ни к одной услуге`);
  });
  if (new Set(services.map((s) => s.slug)).size !== services.length) fail(`${dir}: slug повторяется`);

  return services.sort((a, b) => a.order - b.order);
}

/* ---------- Безопасность: CSP берём из vercel.json, чтобы политика была в одном месте ---------- */

async function loadCsp() {
  const vercel = await readJson('vercel.json');
  const header = vercel.headers
    ?.flatMap((rule) => rule.headers)
    .find((h) => h.key.toLowerCase() === 'content-security-policy');
  if (!header) fail('vercel.json: не найден заголовок Content-Security-Policy');

  // frame-ancestors в мета-теге не работает и даёт предупреждение в консоли
  const meta = header.value.split(';').map((d) => d.trim())
    .filter((d) => d && !d.startsWith('frame-ancestors')).join('; ');

  const config = await readText('js/config.js');
  const endpoint = config.match(/FORM_ENDPOINT:\s*'([^']*)'/)?.[1];
  if (endpoint) {
    const { origin } = new URL(endpoint);
    const connect = meta.split('; ').find((d) => d.startsWith('connect-src')) || '';
    if (!connect.split(' ').includes(origin)) {
      fail(`vercel.json: домен обработчика формы ${origin} не добавлен в CSP connect-src`);
    }
  }
  return meta;
}

/* ---------- Секреты: токен бота не должен попасть в публичный репозиторий ---------- */

const TELEGRAM_TOKEN_RE = /\d{8,10}:[A-Za-z0-9_-]{35}/;

async function checkNoSecrets() {
  const files = [
    ...(await readdir(path.join(ROOT, 'n8n'))).filter((f) => f.endsWith('.json')).map((f) => `n8n/${f}`),
    ...(await readdir(path.join(ROOT, 'js'))).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
  ];
  await Promise.all(files.map(async (file) => {
    if (TELEGRAM_TOKEN_RE.test(await readText(file))) {
      fail(`${file}: похоже на токен Telegram-бота. Токен хранится только в n8n → Credentials, `
        + 'в файле должна остаться заглушка BOT_TOKEN_TG. Если токен уже был в git — перевыпустите его у @BotFather');
    }
  }));
}

/* ---------- n8n: режим работы, услуги и адрес сайта зашиты в код узлов — сверяем с content/ ---------- */

const WORKFLOW = 'n8n/shesterenka-leads.json';

function readConst(code, name, node) {
  const match = new RegExp(`const ${name} = (.+?);`).exec(code);
  return match ? match[1] : fail(`${WORKFLOW}: в узле «${node}» нет константы ${name}`);
}

const scheduleFrom = (literal) => JSON.stringify(Object.fromEntries(
  [...literal.matchAll(/(\d): \[(\d+), (\d+)\]/g)].map(([, day, open, close]) => [day, [Number(open), Number(close)]]),
));

async function checkWorkflowSync(site, services) {
  const nodes = (await readJson(WORKFLOW)).nodes;
  const code = (name) => nodes.find((n) => n.name === name)?.parameters.jsCode ?? fail(`${WORKFLOW}: нет узла «${name}»`);
  const mismatch = (node, what) => fail(`${WORKFLOW}: в узле «${node}» ${what} расходится с content/ — поправьте узел в n8n и в файле`);

  ['Проверка и очистка', 'Диалог бота'].forEach((node) => {
    if (scheduleFrom(readConst(code(node), 'SCHEDULE', node)) !== site.bookingSchedule) mismatch(node, 'SCHEDULE');
  });
  const dialog = code('Диалог бота');
  const titles = JSON.stringify(services.map((s) => s.title));
  if (JSON.stringify(JSON.parse(readConst(dialog, 'SERVICES', 'Диалог бота'))) !== titles) mismatch('Диалог бота', 'SERVICES');
  if (Number(readConst(dialog, 'DAYS_AHEAD', 'Диалог бота')) !== site.booking.daysAhead) mismatch('Диалог бота', 'DAYS_AHEAD');
  if (readConst(dialog, 'SITE_URL', 'Диалог бота') !== `'${site.url}'`) mismatch('Диалог бота', 'SITE_URL');
}

/* ---------- Микроразметка: только подтверждённые факты ---------- */

const toJsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

function businessLd(site) {
  const ld = {
    '@type': 'AutoRepair', name: site.legalName, url: `${site.url}/`, areaServed: site.city,
    openingHoursSpecification: site.hours.ld,
  };
  // Тестовые и неизвестные данные поисковикам не отдаём: они попали бы в карточку организации
  if (site.phone.tel && !site.phone.test) ld.telephone = site.phone.tel;
  if (!isPlaceholder(site.address.full) && !site.address.test) {
    ld.address = { '@type': 'PostalAddress', streetAddress: site.address.full };
  }
  return ld;
}

function serviceLd(site, service, canonical) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: `${site.url}/` },
        { '@type': 'ListItem', position: 2, name: 'Услуги', item: `${site.url}/uslugi/` },
        { '@type': 'ListItem', position: 3, name: service.title, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: service.heading,
      areaServed: site.city,
      provider: businessLd(site),
      offers: service.items.map((i) => ({
        '@type': 'Offer', name: i.name, priceCurrency: 'RUB', price: i.priceText.replace(/\D/g, ''),
      })),
    },
  ];
}

function faqLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.filter((f) => !isPlaceholder(f.a)).map((f) => ({
      '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/* ---------- Страницы ---------- */

const rootFor = (pagePath) => '../'.repeat(pagePath.split('/').length - 1);
const outFile = (pagePath) => (pagePath === '' || pagePath.endsWith('/') ? `${pagePath}index.html` : pagePath);

function pageSeo(page, { site, home, promo }) {
  if (page.service) return page.service.seo;
  const seoByTemplate = {
    index: home.seo,
    services: home.servicesPage.seo,
    prices: home.pricesPage.seo,
    booking: home.bookingPage.seo,
    terms: home.termsPage.seo,
    faq: home.faqPage.seo,
    akcii_predlozheniya: promo.seo,
    privacy: { title: `Политика конфиденциальности — ${site.name}`, description: 'Порядок обработки персональных данных.' },
    404: { title: `Страница не найдена — ${site.name}`, description: 'Страница не найдена.' },
  };
  return seoByTemplate[page.template] ?? fail(`нет title и description для шаблона ${page.template}`);
}

// Заголовок и вводный текст шапки внутренних страниц
function heroText(page, home, promo) {
  if (page.service) return { heroTitle: page.service.heading, heroLead: home.servicePage.lead };
  const byTemplate = {
    services: home.servicesPage,
    prices: home.pricesPage,
    booking: home.bookingPage,
    terms: home.termsPage,
    faq: home.faqPage,
    akcii_predlozheniya: promo,
  };
  const text = byTemplate[page.template];
  return { heroTitle: text?.title ?? '', heroLead: text?.lead ?? '' };
}

// Страницы услуг встают сразу после каталога
function allPages(services) {
  const servicePages = services.map((service) => ({ path: `uslugi/${service.slug}/`, template: 'service', service }));
  const catalog = PAGES.findIndex((p) => p.template === 'services');
  return [...PAGES.slice(0, catalog + 1), ...servicePages, ...PAGES.slice(catalog + 1)];
}

function pageContext(page, shared, services) {
  const root = page.root ?? rootFor(page.path);
  const homeUrl = root || './';
  const link = (target) => (target === '' ? homeUrl : `${root}${target}`);
  const nav = PAGES.filter((p) => p.nav).map((p) => ({
    label: p.nav,
    href: link(p.path),
    cta: Boolean(p.cta),
    currentAttr: p.path === page.path ? ' aria-current="page"' : '',
  }));
  const card = (s) => ({ ...s, href: link(`uslugi/${s.slug}/`), bookHref: `${link('zapis/')}?usluga=${s.slug}` });
  const canonical = page.noindex ? '' : `${shared.site.url}/${page.path}`;

  let jsonLd = '';
  if (page.template === 'index') jsonLd = toJsonLd({ '@context': 'https://schema.org', ...businessLd(shared.site) });
  if (page.service) jsonLd = toJsonLd(serviceLd(shared.site, page.service, canonical));
  if (page.template === 'faq') jsonLd = toJsonLd(faqLd(shared.faq));

  return {
    ...shared,
    root,
    homeUrl,
    bookUrl: link('zapis/'),
    bookCurrentAttr: page.path === 'zapis/' ? ' aria-current="page"' : '',
    menu: nav.filter((item) => !item.cta),
    footerNav: nav,
    serviceLinks: services.map((s) => ({
      label: s.title, href: link(`uslugi/${s.slug}/`), currentAttr: s.slug === page.service?.slug ? ' aria-current="page"' : '',
    })),
    page: {
      noindex: Boolean(page.noindex),
      solidHeader: Boolean(page.solidHeader),
      canonical,
      jsonLd,
      ...pageSeo(page, shared),
    },
    ...heroText(page, shared.home, shared.promo),
    service: page.service ? card(page.service) : undefined,
    cards: services.filter((s) => s.slug !== page.service?.slug).map(card),
    formServices: services.map((s) => ({ title: s.title, slug: s.slug })),
  };
}

async function loadTemplates(dir) {
  const files = (await readdir(path.join(ROOT, dir))).filter((file) => file.endsWith('.html'));
  const entries = await Promise.all(files.map(async (file) => [file.replace(/\.html$/, ''), await readText(`${dir}/${file}`)]));
  return Object.fromEntries(entries);
}

// Отступы вокруг {{#each}}/{{#if}} оставляют пустые хвосты строк — убираем
const tidy = (html) => html.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');

async function writeOut(rel, content) {
  const file = path.join(DIST, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function sitemap(site, pages) {
  const items = pages.filter((p) => !p.noindex)
    .map((p) => `  <url><loc>${escapeHtml(`${site.url}/${p.path}`)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

const robots = (site) => `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`;

async function build() {
  const [site, prices, rawHome, rawTerms, rawFaq, csp, partials, templates] = await Promise.all([
    loadSite(), loadPrices(), readJson('content/home.json'), readJson('content/terms.json'),
    readJson('content/faq.json'), loadCsp(), loadTemplates('templates/partials'), loadTemplates('templates'),
    checkNoSecrets(),
  ]);
  const rawPromo = await readJson('content/akcii_predlozheniya.json');
  const substitute = makeSubstitute(prices, rawTerms);
  const terms = substitute(rawTerms);
  const home = substitute(rawHome);
  const faq = substitute(rawFaq).items;
  const promo = substitute(rawPromo);
  requireFields(promo, ['seo.title', 'seo.description', 'title', 'offers'], 'content/akcii_predlozheniya.json');
  const services = (await loadServices(prices, site)).map((s) => ({
    ...s,
    // Вложенных циклов в шаблонах нет: строки цен карточки собираем заранее из общей части
    rowsHtml: s.items.map((it) => render(partials['price-row'], { it }, 'templates/partials/price-row.html', partials)).join(''),
  }));

  [[site, 'content/site.json'], [prices.items, 'content/prices.json'], [prices.conditions, 'content/prices.json'],
    [home, 'content/home.json'], [terms, 'content/terms.json'], [faq, 'content/faq.json'],
    [promo, 'content/akcii_predlozheniya.json']]
    .forEach(([data, source]) => checkForbidden(data, source));
  services.forEach((s) => checkForbidden(s, `content/services/${s.slug}.json`));
  await checkWorkflowSync(site, services);

  await rm(DIST, { recursive: true, force: true });
  await Promise.all(STATIC_DIRS.map((dir) => cp(path.join(ROOT, dir), path.join(DIST, dir), {
    recursive: true,
    filter: (src) => !path.basename(src).startsWith('.'),
  })));

  const shared = {
    site,
    home,
    terms,
    faq,
    promo,
    csp,
    year: new Date().getFullYear(),
    published: new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }),
    conditions: prices.conditions,
    // Условия по номеру пункта для шаблонов: {{cond.p13.text}}
    cond: Object.fromEntries(prices.conditions.map((c) => [`p${c.point}`, c])),
    partsNote: `${prices.byPoint.get(12).value} (п.\u00a012)`,
    // Таблица «Цены»: плоский список, первая строка группы несёт название услуги
    priceRows: services.flatMap((s) => s.items.map((item, i) => ({ ...item, group: i === 0 ? s.title : '', slug: s.slug }))),
    tickerLoop: [...services, ...services].map((s) => s.title),
    steps: home.process.steps.map((step, i) => ({ ...step, num: String(i + 1).padStart(2, '0') })),
  };

  const pages = allPages(services);
  await Promise.all(pages.map((page) => {
    if (!(page.template in templates)) fail(`templates/${page.template}.html: шаблон не найден`);
    const ctx = pageContext(page, shared, services);
    const html = render(templates[page.template], ctx, `templates/${page.template}.html`, partials);
    return writeOut(outFile(page.path), tidy(html));
  }));

  await writeOut('sitemap.xml', sitemap(site, pages));
  await writeOut('robots.txt', robots(site));

  const indexed = pages.filter((p) => !p.noindex).length;
  console.log(`Готово: ${indexed} страниц в карте сайта (+ privacy, 404), ${services.length} услуг, `
    + `${prices.items.length} работ в прайсе → dist/`);
}

build().catch((error) => {
  console.error(error instanceof BuildError ? `Ошибка сборки: ${error.message}` : error);
  process.exit(1);
});
