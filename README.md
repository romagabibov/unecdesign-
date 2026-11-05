# UNEC Dizayn Shop

Магазин работ студентов UNEC Dizayn Məktəbi. Интерфейс на азербайджанском, цены в AZN. Витрина, каталог, коллекции, поиск, популярные работы, рекомендации, корзина, заявки и отзывы после завершённой покупки. Заказы выдаются в пункте самовывоза. Уведомления о продажах, статусах и новых работах показываются внутри сайта.

## Демо

Для локального просмотра выполни `python -m http.server 8000 --directory dist` из корня проекта и открой `http://localhost:8000/`. Через «Şəxsi kabinet» переключайся между покупателем, студентом и админом. Работы, цены и изображения в демо служат примерами. Изменения хранятся в браузере, платёж симулируется.

## Деплой через GitHub и Vercel

1. Распакуй ZIP и добавь его содержимое в GitHub-репозиторий. Положи `vercel.json` и папку `dist` в корень репозитория.
2. В [Vercel](https://vercel.com/new) выбери **Add New → Project**, подключи GitHub и импортируй этот репозиторий. Оставь **Root Directory** в корне проекта.
3. Нажми **Deploy**. В `vercel.json` уже заданы **Other**, выходная папка `dist` и запуск без установки зависимостей или сборки.

Сайт сразу открывается в деморежиме. Для него достаточно файлов из архива. Для реальных заказов подключи Firebase по шагам ниже. Платежи включаются через Epoint.

[Документация Vercel по GitHub](https://vercel.com/docs/git/vercel-for-github) · [Настройки vercel.json](https://vercel.com/docs/project-configuration/vercel-json)

## Firebase для реальных заказов

1. Возьми Firebase-проект UNEC с тарифом Blaze и доступом на развёртывание. Создай Web App, базу Cloud Firestore **Standard** с ID `(default)` и бакет Cloud Storage. Включи Email/Password в Firebase Authentication. Cloud Functions настроены на `europe-west1`. Для нового проекта выбирай совместимое расположение ресурсов.
2. Скопируй веб-конфигурацию из Firebase Console в `dist/config.js`, установи `mode: "firebase"` и оставь `emulators: false`. Веб-конфигурация Firebase публична. Ключ Epoint хранится отдельно.
3. Установи Node.js 22 и зависимости. Войди в Firebase CLI под аккаунтом с доступом к выбранному проекту.

   ```bash
   npm --prefix functions ci
   npx firebase-tools login
   ```

4. Скопируй `functions/.env.example` в `functions/.env`, укажи HTTPS-адрес магазина в `SHOP_ORIGIN`. Для витрины на Vercel укажи её адрес, например `https://YOUR_PROJECT.vercel.app`, либо свой домен. Для запуска витрины оставь `EPOINT_ENABLED=0`. Функции платежей привязывают секрет даже при отключённой оплате. Для такого развёртывания задай временное значение, которое заменишь ключом мерчанта перед включением оплаты.

   ```bash
   npx firebase-tools functions:secrets:set EPOINT_PRIVATE_KEY --project YOUR_PROJECT_ID
   npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage,functions --project YOUR_PROJECT_ID
   ```

   Этот шаг разворачивает бэкенд в Firebase. Если фронтенд будет на Firebase Hosting, отдельно запусти `npx firebase-tools deploy --only hosting --project YOUR_PROJECT_ID`. Для Vercel достаточно запушить обновлённый `dist/config.js` в GitHub.

5. Для административной команды используй Application Default Credentials с доступом к Firebase Auth и Firestore. Создай первый аккаунт через регистрацию на сайте и назначь роль по его e-mail. После назначения роли заново войди в аккаунт. Роль `student` выдаётся по той же команде. Обычные аккаунты имеют роль покупателя.

   ```bash
   gcloud auth application-default login
   node functions/ops.mjs seed-taxonomy YOUR_PROJECT_ID
   node functions/ops.mjs role YOUR_PROJECT_ID ADMIN_EMAIL admin
   node functions/ops.mjs role YOUR_PROJECT_ID STUDENT_EMAIL student
   ```

6. В кабинете админа доступны категории, коллекции, лоты, заказы и обращения из формы. Студент добавляет изображение, автора, цену и описание. Лот публикует админ. Чтобы добавить лот от имени студента, админ может указать ID его аккаунта, который виден в кабинете студента. Админ ведёт заказ от оплаты до готовности к выдаче и завершения. Покупатель получает возможность оценить работу после завершения заказа.
7. При необходимости включи Firestore TTL на поле `expiresAt` для групп коллекций `rateLimits` и `viewMarkers`. Эти записи используются для ограничений и подсчёта просмотров.

## Активация Epoint

1. Подключи аккаунт мерчанта UNEC в Epoint. Укажи подтверждённый адрес магазина и URL HTTPS-функции `epointCallback` из результата развёртывания как `result_url`.
2. Запиши публичный идентификатор в `EPOINT_PUBLIC_KEY`, замени значение секрета через `functions:secrets:set`, установи `EPOINT_ENABLED=1` и заново разверни функции. Если мерчант подтверждает отдельный банковский домен редиректа, добавь именно его в `EPOINT_REDIRECT_HOSTS`.
3. Проверь успешную оплату и отклонение в тестовой конфигурации мерчанта. Карточные поля находятся на стороне провайдера. Сервер сам пересчитывает сумму в AZN, резервирует остаток и сверяет подписанный результат с транзакцией. Возврат пользователя в магазин открывает кабинет с историей заказов. При открытом платеже остаток остаётся зарезервированным до итогового статуса провайдера. Возвраты оформляются в кабинете Epoint. При физическом возврате работы админ корректирует остаток.

Документация [Firebase](https://firebase.google.com/docs/functions/callable) · [Epoint](https://developer.epoint.az/az)

## Проверка на эмуляторах

Команда использует тестовый проект и имитацию оплаты на сервере. Тест вызывает серверные обработчики напрямую и проверяет роли, приватность заказов, загрузку фото, модерацию, покупку последнего экземпляра двумя покупателями одновременно, повтор запроса, историю продаж и отзывы.

```bash
npm --prefix functions ci
npx firebase-tools emulators:exec --project demo-unec-dizayn-shop --only auth,firestore,storage 'node functions/emulator-smoke.test.mjs'
```
