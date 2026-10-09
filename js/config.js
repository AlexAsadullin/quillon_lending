/*
 * Настройки сайта. Секреты (токены ботов, ключи API) здесь хранить НЕЛЬЗЯ:
 * этот файл скачивает каждый посетитель.
 *
 * FORM_ENDPOINT — URL обработчика заявок (n8n webhook, свой бэкенд и т.п.).
 * Он принимает POST с JSON { name, phone, car, problem, consent, page, sentAt }.
 * После указания адреса добавьте его домен в CSP `connect-src` в index.html.
 * Пока адрес пустой: на localhost форма работает в демо-режиме,
 * на боевом домене — честно сообщает, что заявка не отправлена, и показывает телефон.
 */
window.APP_CONFIG = Object.freeze({
  FORM_ENDPOINT: 'https://alex12334567.app.n8n.cloud/webhook/shesterenka-lead',
  PHONE_DISPLAY: '+7 (495) 000-00-00',
  REQUEST_TIMEOUT_MS: 10000,
  RESEND_DELAY_MS: 60000,
});
