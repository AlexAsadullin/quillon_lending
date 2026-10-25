/*
 * Настройки сайта. Секреты (токены ботов, ключи API) здесь хранить НЕЛЬЗЯ:
 * этот файл скачивает каждый посетитель.
 *
 * FORM_ENDPOINT — URL обработчика заявок (n8n webhook, свой бэкенд и т.п.).
 * Он принимает POST с JSON { name, phone, car, problem, service, visitDate, visitTime, consent, source, page, sentAt }
 * (source — utm_source из ссылки, без метки — web).
 * После указания адреса добавьте его домен в CSP `connect-src` в vercel.json —
 * сборка (scripts/build.mjs) проверит это и подставит политику во все страницы.
 * Пока адрес пустой: на localhost форма работает в демо-режиме,
 * на боевом домене — честно сообщает, что заявка не отправлена, и показывает телефон.
 */
window.APP_CONFIG = Object.freeze({
  FORM_ENDPOINT: 'https://adfdad.app.n8n.cloud/webhook/shesterenka-lead',
  REQUEST_TIMEOUT_MS: 10000,
  RESEND_DELAY_MS: 60000,
});
