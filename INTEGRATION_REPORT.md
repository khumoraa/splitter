# INTEGRATION_REPORT — связка frontend ↔ backend

> **Статус: исправления из раздела 6 применены (кроме `.env`, см. раздел 8).** Хэши коммитов, проверки и что осталось — в разделе 8. Разделы 1–7 описывают состояние ДО исправлений.

Дата: 2026-10-20. Код проектов НЕ менялся (только этот отчёт). Секреты в отчёт не попали (токены в выводах заменены на `***`).
Живой прогон: `http://10.20.2.24:3001` (текущий LAN-адрес Mac, как с телефона), заголовки как у axios (`Content-Type: application/json`, `Authorization: Bearer …`). Тестовые пользователи `It*/G*` созданы заново, существующие не трогались. Скрипты прогона лежат вне репозитория: `/private/tmp/claude-501/-Users-vazira-Desktop-------/4b274102-5cc0-4a9b-a21b-e31e4ccd9fa3/scratchpad/int/{run.mjs,run2.mjs,receipt.jpg}`.

## Итог одной строкой

**Главное расхождение — не в коде API, а в адресе:** в `splitter-frontend-main/.env` стоит `172.20.10.2`, а Mac сейчас в сети `10.20.2.24`; этот старый адрес вшит в собранный бандл, и Metro запущен с ним же. Все остальные контракты сходятся; реальные дефекты: недействительный ключ Gemini (скан → 502), слабая проверка пароля на форме регистрации, нет R2 для аватаров, и несколько мелочей (раздел 4).

## 1. Базовый адрес и конфигурация (проверено запуском)

| Проверка | Результат | Доказательство |
|---|---|---|
| Где фронт берёт адрес | единственное место `src/features/auth/api/index.ts:6`: `process.env.EXPO_PUBLIC_API_URL \|\| 'http://localhost:3001'` | grep по `app/`, `src/`: других `localhost`/IP/портов нет (кроме флага `EXPO_PUBLIC_DEBUG_HISTORY`) |
| Значение в `.env` | `EXPO_PUBLIC_API_URL=http://172.20.10.2:3001` | `splitter-frontend-main/.env:1` |
| Текущий IP Mac | `10.20.2.24` (`ipconfig getifaddr en0`); интерфейса с `172.20.10.2` уже нет | `curl http://172.20.10.2:3001/health` → `000` (нет связи) |
| Адрес в бандле | ❌ `172.20.10.2` вшит (1 вхождение в `.hbc`), `10.20.2.24` — 0 | `grep -a` по экспортированному бандлу |
| Порт бэкенда | 3001 совпадает: `lsof` → `node *:3001` | — |
| Metro | запущен ранее с `REACT_NATIVE_PACKAGER_HOSTNAME=172.20.10.2` (QR тоже со старым адресом); порт 8081 слушает `*` | `lsof`, `ps` |
| `EXPO_PUBLIC_*` | Expo подставляет их на этапе сборки бандла, Metro читает `.env` при старте и кэширует трансформацию: после правки `.env` нужен перезапуск `npx expo start -c` | поведение Expo; подтверждено тем, что бандл содержит старый IP |
| Таймауты | ✅ `apiClient` 60 000 мс (`auth/api/index.ts:10`); `/sessions/scan` 120 000 мс (`receipt.api.ts:116`) — в требуемом диапазоне 90–120 с | чтение кода |
| Сервер слушает | ✅ `0.0.0.0` (`lsof`: `*:3001`); `/health` по `127.0.0.1` и `10.20.2.24` → 200 | curl |
| CORS | ✅ не мешает: запросы без `Origin` (React Native) пропускаются; `OPTIONS /auth/login` → 204 | curl |
| Лимит тела | ✅ `express.json` `4mb`: тело ~300 КБ, 2.5 МБ, 3.5 МБ, 3.9 МБ → разобрано (400 от самого маршрута, не 413); ~5 МБ → **413** `{"success":false,"error":"request entity too large","code":413}`. Реальное фото после сжатия фронтом (≤1280 px, JPEG 0.45) — десятки–сотни КБ, base64 тестового чека 79 КБ | живой запрос |
| Брандмауэр macOS | ✅ не блокирует: `Firewall is disabled`, `block all: disabled`, `stealth: off` | `socketfilterfw` |

Как проверить связь самому с телефона (брандмауэр на Mac выключен, значит блокировать может только сеть): открыть в Safari/Chrome на телефоне `http://10.20.2.24:3001/health` → должно показать `{"status":"ok"}`. Не открывается — телефон и Mac в разных сетях или Wi‑Fi изолирует клиентов (гостевая сеть/«изоляция AP»); тогда либо точка доступа с телефона, либо `npx expo start --tunnel` для Metro (бэкенду всё равно нужен достижимый адрес).

## 2. Карта контрактов и живая сверка

Статус: ✅ совпадает и проверено запуском; ⚠️ работает, но есть замечание; ❌ расхождение; ❓ не проверено запуском (только чтение кода).

### 2.1 Auth / user / uploads

| Эндпоинт (фронт → бэк) | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `POST /auth/register` {username,email,password} (`RegisterForm`) | `{token, user{id,email,username,uniqueId,avatarUrl}}` | `{token, user{id,email,username,uniqueId}}` — без `avatarUrl` | ⚠️ | 200. Поле отсутствует (undefined вместо null), UI это переживает; `auth.ts:184` |
| `POST /auth/login` {email,password} | то же + `avatarUrl` | `{token,user{…,avatarUrl:null}}`; неверный пароль → **400** `{"error":"Invalid email or password"}` | ✅ | 200 / 400; фронт показывает `data.error` |
| `GET /auth/me` | `User` плоский объект | `{id,email,username,uniqueId,avatarUrl}` | ✅ | 200; без токена 401 `{"error":"Authorization required"}` |
| `POST /auth/logout` (`auth/api/index.ts:161`) | — | **маршрута нет** → 404 HTML | ⚠️ | функция нигде не вызывается (`logout()` в `profile.tsx:692` — действие стора, не API) → мёртвый код |
| `PATCH /user/username` {username} | `User` | `User` плоский | ✅ | 200 |
| `PATCH /user/email` {email} | `User` | `User` плоский | ✅ | 200 |
| `PATCH /user/password` {currentPassword,newPassword} | 2xx | `{success:true}`; неверный текущий → 400 `{"error":"Current password is incorrect"}` | ✅ | 200 / 400 |
| `PATCH /users/me/avatar` {avatarUrl} | `User\|null` (иначе дозапрос `/auth/me`) | `{success,avatarUrl}` (не `User`) | ⚠️ | 200. `updateAvatar` (`auth/api/index.ts:204–207`) вернул бы `{success,avatarUrl}` как `User`, но функция нигде не вызывается (профиль использует `uploadAvatar`/`resetAvatar`) |
| `DELETE /users/me/avatar` | `User\|null` | `{success:true,avatarUrl:<placeholder>}` | ❌ | 200. `resetAvatar` (`auth/api/index.ts:261`) возвращает этот объект как `User`, и `profile.tsx:533–535` делает `setUser(updatedUser)`: в сторе остаются только `success` и `avatarUrl` (без `id`, `username`, `email`, `uniqueId`), аватар становится placeholder‑URL вместо `null`. Дальше ломаются все места, где нужен `user.uniqueId` (участники, расчёты «кто кому должен»). Доказательство — чтение кода + живой ответ; на устройстве ❓ |
| `POST /uploads/avatar` multipart `file` | `{success,avatarUrl,key}` | без R2-ключей → **500** `{"error":"Server error"}` (в логе: `R2 config missing`) | ❌ (нужны R2‑ключи) | 500; код ответа при корректных ключах не проверен ❓ |
| `GET /users/:id`, `PATCH /user/update`, `DELETE /user/delete`, `GET /user/list` | не вызываются | есть | — | неиспользуемые маршруты |

### 2.2 Friends

| Эндпоинт | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `GET /friends/search?q=<uniqueId>` | `[{…}]` по zod `ZUserLoose` | `[{id,email,username,uniqueId,avatarUrl}]` | ✅ | 200; **zod OK** на реальном ответе |
| `POST /friends/request` {uniqueId} | произвольный | `{success,action:"requested",id}` | ✅ | 200 |
| `GET /friends/requests` | `{incoming:[{id,from{id,…}}], outgoing:[…]}` | точно такая форма; `outgoing[].to` | ✅ | 200; **zod OK** для B (incoming) и A (outgoing) |
| `PATCH /friends/accept` {uniqueId:<свой>, requesterId:<from.id>} | произвольный | `{success,id}` | ✅ | 200; фронт шлёт ровно эти поля (`RequestList.tsx:94`, `friends.api.ts:54`) |
| `PATCH /friends/reject` | то же | то же по коду | ❓ | не вызывался |
| `GET /friends` | массив по `ZFriendLoose` (`avatarUrl: z.string().optional()`) | `[{id,email,username,uniqueId,avatarUrl:<строка>}]` | ✅⚠️ | 200, **zod OK**; но схема не допускает `null` для `avatarUrl` — упадёт, если бэк когда-либо вернёт null (сейчас подставляет placeholder) |
| `DELETE /friends/:uniqueId` (url-encoded `#`) | `{success\|removed}` | по коду | ❓ | не вызывался |
| `POST /friends/invite` {expiresInSeconds} | `{token,url,expiresAt}` | ровно так, `url` вида `http://<host>:3001/friends/join?token=…` | ✅ | 200. `url` строится из адреса запроса — зависит от того, по какому адресу пришёл клиент |
| `POST /friends/join` {token} | 200 | по коду | ❓ | не вызывался |

### 2.3 Groups

| Эндпоинт | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `POST /groups` {name} | `Group` | `{id,name,ownerId,createdAt}` | ✅ | 200 |
| `GET /groups` | `Group[]` (`counts.members`, `members[]`) | `[{…,counts{members,sessions},members[…owner first]}]` | ⚠️ | 200; `counts.members` **не включает владельца** (0 при одном участнике-владельце; 2 при владельце + 2 участниках), а `members.length` включает → UI «N members» может расходиться с реальностью (`groups.ts:168`) |
| `GET /groups/:id` | `{group,members,role}` | точно такая форма | ✅ | 200 |
| `POST /groups/:id/members` {uniqueId} | `{success}` | `{success:true}` | ✅ | 200 |
| `PATCH /groups/:id` {name} | `Group` | `{id,name,ownerId,createdAt}` | ✅ | 200 |
| `DELETE /groups/:id/members/:uniqueId` (`%23`) | `{success}` | `{success:true,removed:true}` | ✅ | 200 |
| `PATCH /groups/:id/members/:uniqueId/promote` | `{success}` | `{success:true,transferred:true}` — это **передача владения**, после неё прежний владелец получает 403 на invite/delete | ⚠️ | 200; UI‑вызова `promote` в экранах нет (grep) → риск только если появится кнопка |
| `POST /groups/:id/invite` {expiresInSeconds} | `{token,url,expiresAt}` | так и есть | ✅ | 200 |
| `POST /groups/join` {token} | 200 | `{joined:true,friendship:"created",member:"created"}` (заодно создаёт дружбу с владельцем) | ✅ | 200 |
| `GET /groups/lookup` | не вызывается | недостижим: маршрут объявлен **после** `GET /:groupId` (`groups.ts:218` vs `:320`) → 400 `Invalid groupId` | ⚠️ | мёртвый маршрут |
| `POST /groups/:id/leave` | не вызывается | есть | — | — |

### 2.4 Sessions

| Эндпоинт | Фронт ожидает | Бэк отдаёт | Статус | Доказательство |
|---|---|---|---|---|
| `POST /sessions/scan` {sessionName,language,image{mimeType,data}} | `{sessionId,sessionName,language,items[{id,name,unitPrice,quantity,totalPrice,kind}],summary{grandTotal,currency},source}` | с настоящим JPEG (59 КБ) → **502** `{"error":"Could not recognize the receipt…"}` | ❌ (ключ Gemini недействителен) | лог сервера: `HTTP 401 API key not valid` на всех моделях (UNAUTHENTICATED). Форма успешного ответа проверена ранее, до ключа (mock): совпадает ✅. Реального распознавания **не было** ❓ |
| `POST /sessions/finalize` | `{sessionId,sessionName,status,createdAt,payer?,totals{grandTotal,currency,byParticipant[{uniqueId,username,amountOwed}],byItem},allocations[]}` | полностью эта форма + `payer{uniqueId,username}` | ✅ | 200; сумма 20.00 = items; чужой аккаунт → 403 (раньше) |
| `GET /sessions/history?all=false&limit=10` | `{scope,count,limit,entries[{sessionId,sessionName,finalizedAt,grandTotal(number),currency,participantUniqueIds,isCreator,payer,payload}]}` | точно такая форма; участник (не создатель) видит запись с `isCreator:false` | ✅ | 200 для A и B |
| `POST /sessions`, `GET /sessions`, `PATCH /sessions/:id/close` | не вызываются | есть | — | сессию создаёт `/scan`; для прогона без Gemini использован `POST /sessions` |

Коды ошибок, которые фронт различает (`auth/api/index.ts:72+`): 401 → логаут; 422 → не бывает на бэке (мёртвая ветка); 5xx/прочее → текст из `data.error`. Бэк отдаёт `{error}` (а `errorHandler` для 413 — `{success,error,code}`) — фронт читает `data.message || data.error` ✅. 403/404/409/400 показывают серверный текст (английский). 502/503 от OCR — серверный текст ✅. Тайм-аут/нет сети — переведённые `ApiError`.

## 3. Авторизация (чтение кода + живые 401)

- Токен хранится в SecureStore (`token-storage.ts`), на web — AsyncStorage; интерцептор запроса при каждом вызове читает его и ставит `Authorization: Bearer …` ✅.
- 401 → `emitUnauthorized()` → `logout()` (удаляет токен) → `router.replace('/')`. Бесконечного цикла нет: `/auth/login` и `/auth/register` на ошибки отвечают 400/409/415, а не 401. ⚠️ Если одновременно уходят несколько запросов (главная + друзья + группы) и токен просрочен, `emitUnauthorized` сработает несколько раз → лишние `logout`/`replace` (безвредно, но шумно).
- После моих правок: `ApiError` (`kind`,`status`); автологин (`initializeAuth`) удаляет токен только при `status === 401` (раньше — по английскому слову «authorization»); при старте без сети токен сохраняется, профиль подтянется позже ✅ (код). Splash ждёт чтения токена, не сети ✅.
- ⚠️ Латентное: `history.api.ts:196` проверяет `error.code === 'ERR_CANCELED'`, но интерцептор превращает любую ошибку в `ApiError` без `code` (так же, как и старый код превращал в `Error`) → отмена запроса показалась бы как «нет соединения». Сейчас отмена не вызывается (`cancelCurrentRequest` нигде не используется) — риск нулевой, но проверка мёртвая.

## 4. Несовпадения по приоритету

**P0 — в Expo Go ничего не заработает**
1. `splitter-frontend-main/.env:1` — устаревший IP `172.20.10.2` (сейчас `10.20.2.24`), вшит в бандл и в QR запущенного Metro. Приложение получит «нет соединения» на всех запросах.

**P1 — ломает функцию**
2. `POST /sessions/scan` → 502 для любого изображения: недействительный `GEMINI_API_KEY` (`HTTP 401 API key not valid`). Плюс бэкенд перебирает все ~10 моделей даже при 401 (бессмысленно, до 40 с на больших телах) — `receiptParser.ts:372`.
3. `resetAvatar`/`updateAvatar` ждут `User`, бэк (`/users/me/avatar` PATCH/DELETE) отдаёт `{success,avatarUrl}`: в `profile.tsx:533` стор получит объект без `id/username/…` (`auth/api/index.ts:204,261`).
4. `RegisterForm.tsx:22` — пароль `min(6)`, а бэк требует ≥8 + заглавная + строчная + цифра + спецсимвол (`validation.ts`): пароль вроде `abcdef` проходит форму и получает серверный 400 на английском.
5. `POST /uploads/avatar` → 500 «Server error» без R2‑ключей; пользователь не понимает причину (`uploads.ts:146`).

**P2**
6. `counts.members` без владельца (`groups.ts:168`).
7. `GET /groups/lookup` недостижим (порядок маршрутов, `groups.ts:218/320`).
8. `register` не возвращает `avatarUrl` (`auth.ts:184`).
9. Мёртвый код: `logout()` в `auth/api/index.ts:161` (маршрута нет), ветка `422`, проверка `ERR_CANCELED`.
10. `ZFriendLoose.avatarUrl` не допускает `null` (`friends.api.ts:19`).
11. Серия 401 вызывает несколько `logout` (`auth-events.ts`).
12. `PATCH /groups/…/promote` = передача владения (осторожно при добавлении UI).

## 5. Проверено запуском / только чтением

**Запуском:** `/health` по loopback и LAN; запись адреса в бандле; слушающие порты и брандмауэр; регистрация A/B/C, логин, `/auth/me` (в т.ч. 401), `/user/username|email|password`, `/users/me/avatar` PATCH/DELETE, `/friends/search|request|requests|accept|invite|list` (с zod фронта на реальных ответах), `/groups` (create, list, details, add member, rename, invite, delete member, join, promote), `/sessions/scan` (502, причина в логе), `/sessions` (create), `/sessions/finalize`, `/sessions/history` (создатель и участник), `/uploads/avatar` (500), лимит тела 300 КБ…5 МБ, CORS preflight; `tsc` обоих (0 ошибок); `npm test` бэка 6/6 и фронта 16/16; `expo-doctor` 18/18; `expo export --platform android` (8.27 MB); `eslint` 0 ошибок / 37 предупреждений.

**Только чтением кода:** поведение 401/логаута на устройстве, интерцепторы, формы, `friends/reject`, `DELETE /friends/:id`, `friends/join`, отмена запросов, мультиформ‑аплоад на React Native (`Content-Type: multipart/form-data` без boundary задан вручную, `auth/api/index.ts:189` ❓), общий тип‑контракт (фронт и бэк **не делят типы**, описаны вручную в двух местах; расхождений в проверенных эндпоинтах не найдено).

**Не проверено ❓:** распознавание настоящего чека (нет рабочего ключа), загрузка аватара в R2, Expo Go на устройстве.

## 6. Предлагаемые исправления (НЕ применены)

```diff
# 1) splitter-frontend-main/.env  (локальный файл, не в git)
-EXPO_PUBLIC_API_URL=http://172.20.10.2:3001
+EXPO_PUBLIC_API_URL=http://10.20.2.24:3001
# затем: остановить Metro и запустить  npx expo start -c  (-c чистит кэш, иначе остаётся старый адрес)
```

```diff
# 2) splitter-backend-main/src/services/receiptParser.ts  (~строка 372, catch цикла по моделям)
     } catch (err: any) {
       lastError = err;
       const status = err?.status || err?.statusCode;
+      // an invalid/forbidden key will fail identically on every model: stop early
+      if (status === 401 || status === 403) {
+        console.error("[parseReceipt] Gemini rejected the API key (HTTP " + status + ")");
+        throw new ReceiptParseError(
+          "Receipt recognition is misconfigured on the server (invalid API key)",
+          503
+        );
+      }
```
(у `generateViaRest` статус в `err.status` — проверить перед применением на реальном 401; в логе строка `HTTP 401 (401)` показывает, что код доступен.)

```diff
# 3) splitter-frontend-main/src/features/auth/ui/RegisterForm.tsx:22  (то же правило, что на сервере)
-  password: z.string().min(6, 'Password must be at least 6 characters'),
+  password: z
+    .string()
+    .min(8, 'Password must be at least 8 characters')
+    .regex(/[A-Z]/, 'Password must include an uppercase letter')
+    .regex(/[a-z]/, 'Password must include a lowercase letter')
+    .regex(/\d/, 'Password must include a number')
+    .regex(/[^A-Za-z0-9]/, 'Password must include a special character'),
# (сообщения лучше вывести через t('settings.password.error*'), ключи уже есть)
```

```diff
# 4) splitter-frontend-main/src/features/auth/api/index.ts  — resetAvatar/updateAvatar: бэк возвращает {success,avatarUrl}, а не User
 export async function resetAvatar(): Promise<User> {
-  const response = await apiClient.delete<User | null>('/users/me/avatar');
-  if (response.data) {
-    return response.data;
-  }
-  return getCurrentUser();
+  await apiClient.delete('/users/me/avatar');
+  return getCurrentUser();
 }
# и то же для updateAvatar (строки ~204–207)
```

```diff
# 5) splitter-backend-main/src/routes/uploads.ts:144-147
     } catch (err) {
       console.error("POST /uploads/avatar error:", err);
-      res.status(500).json({ error: "Server error" });
+      if (err instanceof Error && err.message.startsWith("R2 config missing")) {
+        res.status(503).json({ error: "Avatar storage is not configured on the server" });
+        return;
+      }
+      res.status(500).json({ error: "Server error" });
       return;
     }
```

```diff
# 6) splitter-backend-main/src/routes/groups.ts:168  — считать владельца в counts.members
-        counts: { members: g._count.members, sessions: g._count.sessions },
+        counts: { members: members.length + 1, sessions: g._count.sessions },
# где members.length = число записей без владельца; либо использовать [ownerEntry, ...memberEntries].length
```

```diff
# 7) splitter-backend-main/src/routes/groups.ts  — перенести router.get("/lookup", …) (строка 320) выше router.get("/:groupId", …) (строка 218), либо удалить маршрут, если он не нужен
```

```diff
# 8) splitter-backend-main/src/routes/auth.ts:184  (register)
         uniqueId: user.uniqueId,
+        avatarUrl: user.avatarUrl ?? null,
```

```diff
# 9) splitter-frontend-main/src/features/auth/api/index.ts:161 — удалить мёртвую logout() (POST /auth/logout отсутствует на бэке)
```

```diff
# 10) splitter-frontend-main/src/features/friends/api/friends.api.ts:19
-  avatarUrl: z.string().optional(),
+  avatarUrl: z.string().nullish(),
```

```diff
# 11) splitter-frontend-main/src/shared/api/auth-events.ts — выдавать событие один раз за серию 401
+let emitting = false;
 export function emitUnauthorized(): void {
+  if (emitting) return;
+  emitting = true;
+  setTimeout(() => { emitting = false; }, 1500);
   unauthorizedListeners.forEach((listener) => {
```

```diff
# 12) splitter-frontend-main/src/features/auth/api/index.ts (интерцептор ответа) — отмена запроса как отдельный тип, чтобы работала проверка в history.api.ts
+import axios from 'axios';
 ...
 (error: AxiosError<any>) => {
+  if (axios.isCancel(error)) throw new ApiError('Request cancelled', 'unknown');
# и в history.api.ts:196 проверять error.message === 'Request cancelled' || error.code === 'ERR_CANCELED'
```

Дополнительно (рекомендация, не diff): завести `scripts/dev.sh`, который берёт `ipconfig getifaddr en0`, пишет `EXPO_PUBLIC_API_URL` в `.env` и запускает `REACT_NATIVE_PACKAGER_HOSTNAME=<ip> npx expo start -c`, — тогда смена сети (а она у вас уже менялась дважды) не ломает связку.

## 7. Что запускать

```bash
cd /Users/vazira/Desktop/коворк/splitter-frontend-main && export PATH=$HOME/.local/node/bin:$PATH && IP=$(ipconfig getifaddr en0) && echo "EXPO_PUBLIC_API_URL=http://$IP:3001" > .env && REACT_NATIVE_PACKAGER_HOSTNAME=$IP npx expo start -c
```
(бэкенд и PostgreSQL должны уже работать: `curl http://$IP:3001/health`). **На телефоне:** подключиться к той же сети, что и Mac, открыть в браузере `http://<IP Mac>:3001/health` (должно быть `{"status":"ok"}`), затем отсканировать QR в Expo Go. Не забудьте, что скан чека заработает только после замены `GEMINI_API_KEY` на действительный ключ.


## 8. Применённые исправления (ветка fix/stage-2)

После каждого шага запускалось: `tsc --noEmit` (бэкенд и фронт), `npm test` (оба), `expo-doctor`, `expo export --platform android` — на всех шагах без падений.

| № раздела 6 | Что сделано | Коммит | Проверено запуском |
|---|---|---|---|
| 2 | Gemini 401/403 → сразу 503 «invalid API key», без перебора моделей | `9dd2b3d` | Живой запрос с реальным JPEG: 503 за ~0.8 с, в логе одна модель (раньше 502 после перебора всех) |
| 3 | Пароль на форме регистрации = правило сервера (8+, A-Z, a-z, цифра, спецсимвол); сообщения en/ja/uz | `0bdb6b1` | 2 unit‑теста, включая сверку с копией серверного правила на 13 паролях; тест паритета локалей |
| 4 | `resetAvatar`/`updateAvatar` возвращают полный профиль через `getCurrentUser()` (`profile.tsx` проверен: `setUser(updatedUser)`) | `aa6ec70` | Живой: DELETE avatar отвечает `{success,avatarUrl}`, `/auth/me` после этого — полный объект с `avatarUrl: null` |
| 5 (бэк) | `/uploads/avatar` без R2 → 503 «Avatar storage is not configured» (типизированная `R2NotConfiguredError`) | `25c0355` | Живой: 503; без файла по‑прежнему 400 |
| 5 (фронт) | Понятное переведённое сообщение при 503 в профиле | `68267f4` | `tsc`, бандл; на устройстве ❓ |
| 6 | `counts.members` включает владельца | `8061829` | Живой: владелец один → 1, владелец + участник → 2 (= длина `members[]`) |
| 8 | `/auth/register` возвращает `avatarUrl: null` | `eaf61b3` | Живой: ключи ответа `id,email,username,uniqueId,avatarUrl` |
| 10 | `ZFriendLoose.avatarUrl` → `z.string().nullish()` | `6a15f74` | `tsc`, бандл |
| 7 | `/groups/lookup` — фронт не использует (grep), поэтому **удалён** (не перенесён) | `4a1afa4` | Живой: теперь запрос попадает в `/:groupId` (400), как и любой несуществующий путь |
| 9 | Удалены мёртвые `logout()` (нет `POST /auth/logout`), ветка 422 и ключ `errors.validation` | `e2f121e` | `tsc`, паритет локалей |
| 11 | Защита от повторных logout: один сигнал 401 за 1.5 с, сброс при входе | `450994f` | 3 unit‑теста (всплеск, после паузы, сброс) |
| 12 | Отмена запроса (`axios.isCancel`) → `ApiError` с `kind: 'cancelled'`; `history.api.ts` его распознаёт | `b4fb210` | Тест на настоящем отменённом запросе axios + хелперы |
| (доп.) | `npm run dev:lan`: подставляет текущий IP в `EXPO_PUBLIC_API_URL` (меняется только эта строка `.env`) и запускает `expo start -c` | `9c2ae84` | 5 unit‑тестов на правку `.env` и выбор IP; dry‑run на копии: `172.20.10.2 → 10.20.2.24`, остальные строки целы, бэкенд опрошен; реальный `.env` скриптом не менялся |
| (доп.) | README: как узнать IP, `.env`, запуск бэкенда и Expo, что делать при смене сети; Node 22; описание 503/502 и `ALLOW_MOCK_OCR` | `ac0447e` | — |

**Пункт 1 (`.env`)** я не применял: вы просили не перезаписывать файл. Сейчас в нём уже стоит `http://10.20.2.24:3001` (совпадает с текущим `ipconfig getifaddr en0`), а при смене сети адрес надёжно обновляет `npm run dev:lan`.

### Итоговые проверки (после последнего коммита кода)
- `tsc --noEmit`: бэкенд 0 ошибок, фронт 0 ошибок.
- `npm test`: бэкенд 6/6, фронт 28/28.
- `expo-doctor`: 18/18.
- `expo export --platform android`: собирается.
- `eslint`: 0 ошибок, 37 предупреждений (как после шага 12; новые предупреждения от моих правок — в тесте api-error и в интерцепторе — убраны).

### Что осталось (не входило в применение)
- Реальное распознавание чека: нужен действительный `GEMINI_API_KEY` (сейчас сервер честно отвечает 503 «invalid API key» вместо 502) ❓.
- Загрузка аватара: нужны R2‑ключи (сейчас понятный 503) ❓.
- Всё на устройстве в Expo Go (в т.ч. multipart‑загрузка аватара с вручную заданным `Content-Type`) ❓.
- `promote` в группах = передача владения; в UI кнопки нет, но если появится — учесть.
- Бэкенд перезапущен мной в фоне (`npm start`, порт 3001) уже с новым кодом; Expo я не запускал (у вас работает свой `expo start -c`).

## 9. Что запускать

В вашем терминале (Expo остановите Ctrl+C, если он уже запущен со старым адресом):

```bash
cd /Users/vazira/Desktop/коворк/splitter-frontend-main && export PATH=$HOME/.local/node/bin:$PATH && npm run dev:lan
```

На телефоне: та же сеть, что у Mac; в браузере телефона открыть `http://<IP Mac>:3001/health` (должно быть `{"status":"ok"}`), затем QR в Expo Go.

## 10. Обновление фронтенда до Expo SDK 57 (ветка upgrade/sdk-57)

Причина: Expo Go на iPhone — SDK 57.0.0, а iOS не даёт поставить старую версию Expo Go. Бэкенд не менялся (`tsc` бэкенда по-прежнему чистый).

### Что изменилось в SDK 55–57 и касается проекта (по официальным changelog/upgrade guide)
| Изменение | Касается нас? | Что сделано |
|---|---|---|
| SDK 55: Legacy Architecture удалена, `newArchEnabled`/`edgeToEdgeEnabled` убраны из `app.json` | Ключей в `app.json` не было | Ничего; `prebuild` включает new arch и edge‑to‑edge сам (проверено) |
| SDK 56: `expo-router` больше не зависит от react-navigation; импорты `@react-navigation/*` в коде запрещены | **Да**: `useFocusEffect`, `useIsFocused` в 6 файлах | Официальный codemod → `expo-router/react-navigation`; пакет `@react-navigation/native` удалён из зависимостей |
| SDK 56: `expo/fetch` — глобальный `fetch` | Только `fetch(asset.uri)` в ветке web профиля; axios на RN использует XHR | Не требуется |
| SDK 56: `expo` не тянет `@expo/vector-icons` | Не используется (grep) | Не требуется |
| SDK 56: Hermes v1 по умолчанию; RN 0.85→0.86, React 19.2 | Да (сборка) | Принято; экспорт iOS/Android собирается |
| SDK 56: TypeScript 6.0.3 в шаблонах | `i18next 25`/`react-i18next 15` объявляют peer `typescript ^5` → `npm install` падает с ERESOLVE | TypeScript оставлен `~5.9.2` через `expo.install.exclude` (`expo-doctor` это принимает) |
| SDK 55: `expo-clipboard` убрано свойство `content` у слушателей | Не используем слушатели | Не требуется |
| SDK 55/56: `expo-status-bar`/`expo-navigation-bar` — большинство пропсов no-op (edge‑to‑edge обязателен) | Пропсов этих модулей в коде нет | Не требуется |
| `expo-camera`, `expo-image-picker`, `expo-secure-store`, `expo-localization`, `expo-image-manipulator` | В официальных заметках 55–57 для них breaking changes не указаны | Используемые API (`CameraView`, `useCameraPermissions`, `launchImageLibraryAsync({mediaTypes:['images']})`, `manipulateAsync`, `getLocales`) компилируются без ошибок |
| `reanimated 4.5` / `worklets 0.10` | Да | `babel-preset-expo` сам подключает worklets‑плагин, поэтому ручную строку `react-native-reanimated/plugin` убрали (иначе плагин применялся бы дважды) |
| Metro: файловая система по требованию, нативный watcher | Нет | Ничего |
| Node: нужен ^20.19.4 / ^22.13 / ^24.3 | У нас 24.22 | ✅ |

### Версии (до → после)
`expo` ~54.0.37 → 57.0.30 · `react-native` 0.81.5 → 0.86.3 · `react` 19.1.0 → 19.2.3 · `expo-router` ~6.0.24 → ~57.0.28 · `expo-camera` ~17.0.10 → ~57.0.6 · `expo-image-picker` ~17.0.11 → ~57.0.20 · `expo-secure-store` ~15.0.8 → ~57.0.4 · `expo-localization` ~17.0.9 → ~57.0.2 · `react-native-reanimated` ~4.1.1 → 4.5.1 · `react-native-worklets` ^0.5.0 → 0.10.1 · `react-native-screens` ~4.16 → ~4.26 · `react-native-svg` 15.12.1 → 15.15.4 · `react-native-gesture-handler` ^2.28 → ~2.32 · `react-native-safe-area-context` ~5.6 → ~5.7 · `react-native-web` 0.21.1 → ^0.21.2 · `@react-native-community/netinfo` 11.4.1 → 12.0.1 · `babel-preset-expo` ~54 → ~57 · `eslint-config-expo` ~10 → ~57.0.2. Без изменений: `axios`, `zod`, `zustand`, `tamagui`, `react-hook-form`, `@tanstack/react-query`, `react-i18next 15`, `i18next` (в рамках ^25), `typescript 5.9.3`.

### Что ломалось и как исправлено (коммиты)
| Проблема | Исправление | Коммит |
|---|---|---|
| `npm install` падал `EOVERRIDE`: точный `overrides.react-native-web 0.21.1` конфликтовал с диапазоном Expo `^0.21.2` | override теперь ссылается на прямую зависимость (`"$react-native-web"`), чтобы `@tamagui/static` не приносил вторую копию 0.20.0 (иначе `expo-doctor` ругался на дубликат) | `c2bc706` |
| `ERESOLVE` на TypeScript 6 / i18next | TypeScript остаётся 5.9 (см. выше); версию i18next не менял | `c2bc706` |
| `@react-navigation/native` больше не нужен | codemod + удаление зависимости | `4fcb834` |
| 3 ошибки `tsc`: `StyleSheet.absoluteFillObject` удалён; `tabBarIcon.color` теперь `ColorValue` | `StyleSheet.absoluteFill`; приведение `color as string` | `f7d7db6` |
| ESLint: 50 новых **ошибок** от React‑Compiler‑правил `react-hooks/{set-state-in-effect,refs,static-components,preserve-manual-memoization}` (eslint-config-expo 57) в 12 файлах | Правила понижены до `warn` в `eslint.config.js` (исправление — рефакторинг, не часть обновления). Итог: 0 ошибок, **87 предупреждений** (было 37; +50 от этих правил) | `997ecdb` |
| Двойное применение worklets‑плагина | убрана ручная строка в `babel.config.js` | `40b6235` |
| `start-all.sh`: `CommandError: Specify at most one of: --offline, --host, --tunnel, --lan, --localhost` (воспроизведено) | офлайн задаётся `EXPO_OFFLINE=1`, флаг `--offline` убран | `e11a997` |

`app.json` менять не пришлось: ключей `newArchEnabled`/`edgeToEdgeEnabled` в нём не было; `prebuild` во временной копии под SDK 57 прошёл (Android: `CAMERA` есть, `RECORD_AUDIO` удалён, `usesCleartextTraffic`; iOS: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, микрофона нет). Единственная заметка `prebuild`: «android: userInterfaceStyle: Install expo-system-ui» — относится только к Android и была и на SDK 54; пакет не добавлялся.

### Проверки (запуском)
`tsc --noEmit` 0 ошибок · `npm test` 28/28 · `expo-doctor` **21/21** · `eslint` 0 ошибок / 87 предупреждений · `expo export --platform ios` и `--platform android` собираются (Hermes, 7.3 и 7.6 МБ) · запущенный Metro отдаёт манифест `sdkVersion: 57.0.0` и собирает dev‑бандл iOS (HTTP 200, 14.3 МБ, 8 с) · бэкенд `tsc` 0 ошибок.

### Совместимость с Expo Go 57 (запуском: сравнение с `expo/bundledNativeModules.json`)
Все 26 пакетов с нативным кодом, найденные в `node_modules` (async-storage, netinfo, expo-camera, expo-image-picker, expo-image-manipulator, expo-secure-store, expo-localization, expo-clipboard, expo-font, expo-constants, expo-linking, expo-router, expo-status-bar, reanimated, worklets, gesture-handler, screens, safe-area-context, svg, masked-view, …), входят в Expo Go, и установленные версии **совпадают с ожидаемыми**. Вне списка только ядро `expo`/`expo-modules-*` (встроено). Остальное (Tamagui, zustand, react-query, axios, zod, react-hook-form, i18next, `react-native-qrcode-svg`) — чистый JS. `expo-build-properties` — только config plugin, в Expo Go не используется. Замен не требуется.

### Не проверено ❓
Запуск на iPhone в Expo Go 57 (устройства нет): возможны поведенческие различия RN 0.86/Hermes v1 в рантайме, которые сборка не ловит; edge‑to‑edge/безопасные зоны на Android; новый механизм `expo/fetch`. 50 предупреждений React‑Compiler‑правил указывают на реальные места (setState в эффектах, refs при рендере), стоит разобрать позже. Предупреждение Metro «react-native contains an invalid package.json configuration» (RN 0.86 + текущий Metro) на сборку не влияет. В режиме `--offline`/`EXPO_OFFLINE=1` Metro не может подтянуть иконки манифеста («Unable to resolve manifest assets») — на работу приложения это не влияет.

### Запуск
`./start-all.sh` (Expo в переднем плане, видно QR) или, как в этой сессии: из `splitter-frontend-main` — `EXPO_OFFLINE=1 REACT_NATIVE_PACKAGER_HOSTNAME=$(ipconfig getifaddr en0) CI=1 npx expo start --lan -c`. Остановить: `./stop-all.sh`.

## 11. Падение при регистрации на iPhone: `undefined is not a function` в expo-router (ветка upgrade/sdk-57)

### Корневая причина (доказано на бандле)
`node_modules/expo-router/build/navigationEvents/navigation.js` делает `const _1 = require(".")` (соседний `index.js`, где экспортируется `emit`) и на строке 13 вызывает `(0, _1.emit)('actionDispatched', …)`. Наш `babel.config.js` содержал `babel-plugin-module-resolver` с **`root: ['./']`**. Плагин применяется и к файлам из `node_modules` и переписал голый специфаер `"."` в путь до корня проекта. В dev‑бандле это видно напрямую:

| Состояние | Что стоит в модуле `navigationEvents/navigation.js` | На что указывает `_1` |
|---|---|---|
| До (наш конфиг) | `require(_dependencyMap[0], "../../../..")` | модуль **id 0 = `index.ts`** нашего проекта (`}, 0, [1], "index.ts"`) → `emit` отсутствует → `TypeError: undefined is not a function` |
| После (убран `root`) | `require(_dependencyMap[0], ".")` | модуль id 961 = `expo-router/build/navigationEvents/index.js` (где `emit` есть) |

Слушатель `__unsafe_action__` ставится, когда навигация готова, поэтому падало на **первом же навигационном действии** (любой `router.replace/push`, в том числе после регистрации), а не только на регистрации.

Эксперименты:
- **A (убрать `config.resolver.alias` из `metro.config.js`)**: результат тот же (`"../../../.."`) → alias не причина; откатил, затем удалил отдельным коммитом как мёртвый (алиасы сами на себя).
- **B (убрать `root` у module-resolver)**: `require(".")` остаётся `"."` и ведёт на `navigationEvents/index.js`; алиас `@/…` продолжает работать; в коде не было импортов относительно корня проекта (`src/…`, `app/…`); обе сборки (iOS/Android) проходят. **Это и есть исправление.**
- **Регрессионный тест** `scripts/babel-config.test.mjs` прогоняет именно этот файл через наш `babel.config.js`: на старом конфиге падает, на новом проходит.
- **C (чистый проект SDK 57)**: не делал — причина установлена экспериментом B и находится в нашем конфиге; в чистом шаблоне нет `module-resolver`, воспроизводиться нечему. Если хотите убедиться на телефоне, скажите, подниму шаблон на 8082.
- **Поиск в GitHub/changelog** (`actionDispatched`, `navigationEvents`, `undefined is not a function`): публичных обращений не найдено — согласуется с тем, что это проблема конфигурации проекта, а не библиотеки.
- B (babel‑плагины tamagui/worklets/React Compiler): worklets‑плагин уже подключается самим `babel-preset-expo` (ручную строку убрали в предыдущем обновлении); конфликтов с SDK 57 в бандле не видно.

### Что изменено (коммиты)
| Хэш | Что |
|---|---|
| `5202cec` | Ожидаемые 4xx (в т.ч. 401 «Invalid token») логируются `console.warn`, а не `console.error` → нет красного экрана в dev; 5xx/сеть остаются `error`; поведение (удаление токена, выход) не менялось; тест `logLevelForStatus` |
| `107189a` | **Исправление причины:** убран `root: ['./']` из module-resolver + регрессионный тест |
| `5b768e9` | Удалён мёртвый Tamagui‑alias в `metro.config.js` |
| `0943b20` | `start-all.sh`: проверка `npx expo whoami` (иначе стоп с «run npx expo login»), без `EXPO_OFFLINE`/`--offline`, запуск `--lan -c` |
| `68b6ab8`, `7bc5a8a` | Тексты ошибок входа/регистрации на языке пользователя по статусу (409 → email занят, 400 → неверные данные/логин‑пароль, 5xx → сервер, сеть/таймаут → переведённое сообщение клиента); английский текст сервера не показывается; 5 unit‑тестов (`7bc5a8a` — исправление типов, которые я пропустил в предыдущем коммите: он был сделан с 2 ошибками `tsc`) |
| `13cb83d` | После входа/регистрации одна навигация `router.replace('/tabs')` (раньше `replace('/')` → Welcome → `<Redirect>` ещё раз; `Redirect` в expo-router — это `useFocusEffect` + `router.replace`, проверено по исходнику) |
| `b6317ee` | Язык: при первом запуске берётся язык телефона (`ja-JP` → `ja`, неподдерживаемый → `en`), сохранённый выбор приоритетнее; Welcome ждёт регидратации сохранённых настроек (нет мигания не того языка); тесты `resolveLanguage` |
| `bc3bed8` | `npm run check:i18n` (+ в `npm test`): ключи, используемые в коде, есть во всех трёх языках, файлы идентичны; 333 ключа, 0 пропусков; фикстура‑тест доказывает, что проверка ловит пропуск |
| `639accd` | Переведены сообщения валидации формы входа и подписи поля пароля (показать/скрыть), новые ключи en/ja/uz; вход требует только непустой пароль (политика сложности — правило регистрации) |
| `2dfe5da` | `useStoreHydrated` через `useSyncExternalStore` (без нового lint‑предупреждения) |

### Проверки
**Запуском:** `tsc --noEmit` фронт 0 / бэкенд 0 ошибок · `npm test` фронт **41/41**, бэкенд 6/6 · `check:i18n` OK (336 ключей) · `expo-doctor` 21/21 · ESLint 0 ошибок, 87 предупреждений (как после обновления SDK) · `expo export` iOS и Android собираются · бэкенд через curl: слабый пароль → 400, без спецсимвола → 400, регистрация → 200, дубль email → 409, неверный пароль → 400, неизвестный email → 400, вход → 200, `/auth/me` с токеном → 200, без токена / с мусорным / с битой подписью → 401 · `npx expo whoami` для вашей сессии проходит (exit 0), симуляция «не вошли» даёт exit 1 `Not logged in` → скрипт остановится.
**Чтением кода:** навигационные вызовы (`router.replace` после входа/выхода/401 — единичные действия из обработчиков), поведение `Redirect`, переключение языка (`I18nProvider` + `useTranslation` перерисовывают экраны; выбор сохраняется через `zustand/persist`).
**Не проверить без телефона ❓:** что `[TypeError…]` действительно ушёл на iPhone (по бандлу причина устранена, но рантайм Expo Go не запускался); регистрация/вход/выход/автологин на устройстве; смена языка EN/JA/UZ вживую и после перезапуска; поведение при отказе сети (баннер офлайна, переведённые ошибки). Тесты самого `app-store` (регистрация/вход/401→выход) не написаны: стор импортирует AsyncStorage/SecureStore, которые не запускаются в `node:test`; логика покрыта через тесты `auth-errors`, `auth-events`, `api-error`, `password`, `languages`.

### Остаётся вам
Телефон (чек‑лист ниже); `GEMINI_API_KEY` действителен, но в `backend/.env` нужна строка `GEMINI_MODEL_PARSE=gemini-3.5-flash` (модели из кода у Google отключены); ключи R2 для аватаров.

## 12. Профиль и настройки: переработка (ветка feature/profile-settings)

Спецификация и аудит «до»: `docs/profile-redesign.md`. Схема БД **не менялась** (миграций нет).

### 12.1 Функции

Проверка: **З** — запуском (curl / интеграционные и unit-тесты / сборка бандла), **К** — только чтением кода, **📱** — нельзя проверить без телефона.

| Функция | Статус | Как проверено |
|---|---|---|
| Загрузка аватара без ключей R2 (диск сервера, отдача по `/media/avatars/<uuid>`, URL от адреса запроса) | ✅ | **З** curl по LAN‑адресу: JPEG 300 КБ → 200, файл отдаётся (`image/jpeg`, 307212 байт); интеграционные тесты |
| Безопасность загрузки: JWT, лимит 5 МБ → 413, тип по magic bytes → 415, кривой multipart → 400, rate‑limit 10/10 мин → 429, UUID‑имена, удаление старого файла | ✅ | **З** curl (401 / 413 / 415 / 400) + 9 интеграционных тестов (в т.ч. 429, отсутствие мусорных файлов) |
| Реальный multipart как у React Native (FormData без ручного Content-Type) | ✅ сервер / 📱 клиент | **З** тесты и `curl -F` шлют multipart без заголовка → 200; ручной `Content-Type: multipart/form-data` без boundary → 400 (это ломало бы старый клиент). Клиент теперь **не задаёт** заголовок (интерцептор снимает его для FormData) — **К**; на устройстве 📱 |
| `avatarUrl` всегда URL или `null` (без placeholder) | ✅ | **З** тесты: `/friends`, `/friends/search`, `/users/:id`, `DELETE /users/me/avatar` |
| Сброс аватара | ✅ | **З** curl: `avatarUrl:null`, старый файл → 404 |
| Смена имени (2–32, буквы/цифры/пробел/`. _ ' -`), клиент = сервер | ✅ | **З** curl + тест паритета клиент↔сервер на 23 значениях |
| Смена email (нужен пароль, формат, уникальность 409) | ✅ | **З** curl и тесты |
| Смена пароля (правила как при регистрации, нужен текущий, пароль не в логах) | ✅ | **З** curl и тест «пароль не попал в лог сервера» |
| Удаление аккаунта (пароль, транзакция, группы/дружбы/история, аватар, токены) | ✅ | **З** curl и сквозной тест: владение группой перешло, одиночная группа/счёт удалены, общий счёт сохранён с «Deleted user», id в истории не остался, токен → 401 `ACCOUNT_DELETED` |
| Экспорт данных (`GET /users/me/export` + файл через меню «Поделиться») | ✅ API / 📱 файл | **З** curl; запись файла и Share Sheet — **К** / 📱 |
| Экран «Профиль»: аватар/инициалы, имя, email, ID с копированием, друзья/группы/счета, pull‑to‑refresh, скелетон, «Повторить» | ✅ код | **З** `tsc`, сборка iOS/Android; внешний вид 📱 |
| «Редактировать профиль»: фото из галереи/камеры, HEIC→JPEG 512×512, прогресс, удалить, отказ в доступе → «Открыть настройки», откат при ошибке | ✅ код | **З** тесты логики (`profile-actions`: при ошибке старый аватар остаётся); `prepareAvatar`/пикер/разрешения — **К** / 📱 |
| QR с ID + «Поделиться» + копирование; сканирование чужого QR = запрос в друзья | ✅ код | **З** тесты формата ссылки и защиты от подделки; камера/сканирование 📱 |
| Настройки (секции Аккаунт, Внешний вид, Язык, Счета, Данные, О приложении, Опасная зона) | ✅ код | **З** `tsc`, `check:i18n`, сборка; визуально 📱 |
| Тема система/светлая/тёмная (сохраняется, сразу применяется) | ⚠️ | **З** тесты `resolveScheme` и контраста WCAG AA обеих палитр; тема переключает `Theme`/StatusBar/`Appearance` для всего приложения, но старые экраны (друзья, группы, скан, история) местами используют жёстко заданные светлые цвета → в тёмной теме они выглядят неполно. Профиль и настройки адаптированы полностью. 📱 |
| Язык EN / 日本語 / O'zbek (родные названия, сразу, сохраняется) | ✅ код | **З** паритет ключей (365 ключей, 0 пропусков); вживую 📱 |
| Валюта по умолчанию (используется для нового счёта, если на чеке нет валюты) | ✅ код | **З** тесты списка валют; влияние на скан — **К** |
| О приложении: версия, политика, условия, лицензии (52 пакета), обратная связь (mailto) | ✅ код | **З** генерация лицензий; тексты политики/условий — **черновик** (см. решения) |
| Хаптики, доступность (роли, подписи, 44 pt, Dynamic Type, Reduce Motion), клавиатура (`textContentType`/`autoComplete`/`returnKeyType`, KeyboardAvoiding) | ✅ код | **К** (VoiceOver, динамический размер, остров/жестовая панель — 📱) |
| 401/400/409 в dev без красного экрана | ✅ | сделано ранее (`console.warn`); новые экраны ловят ошибки сами |
| Блокировка Face ID / Touch ID | ⛔ не реализовано | Face ID на iOS в Expo Go **не поддерживается** (документация Expo) — нужен development build |

### 12.2 Коммиты (от `upgrade/sdk-57`)

- `a148968` docs: profile & settings audit and design specification
- `78a5b6e` feat(backend): pure utilities with tests - image magic bytes, username rules, rate limiter, account anonymizer
- `4b301e8` feat(backend): avatar storage (R2 or local disk), hardened upload, null avatars, account export and deletion
- `ec3b5fb` feat(backend): safer profile endpoints - username rules, email/password need the current password, tokens die 
- `ef19a47` test(backend): integration tests for avatar, profile and account deletion against a separate test database
- `ce09825` chore(deps): add expo-haptics, expo-image, expo-sharing, expo-file-system, expo-application, expo-web-browser,
- `c913937` feat(theme): design tokens (WCAG-checked), theme mode system/light/dark applied app-wide, default currency set
- `83ecef3` feat(profile): logic layer - validation (parity-tested with the server), error mapping by server code, testabl
- `cf604fb` feat(profile): UI kit (screen, sections, rows, buttons, fields, banners, skeleton), cached avatar, haptics
- `2387e38` feat(profile): new Profile, Edit profile, QR & share, grouped Settings with sub-screens, About and legal (en/j
- `2116171` feat(settings): default currency is used for new bills; remove the old profile API functions
- `c6abf95` docs: implementation notes for profile/settings and the new backend endpoints
- `f4815b7` docs: integration report - profile and settings rework

### 12.3 Что изменилось в API (для документации)
- **Добавлено:** `GET /users/me/export`; `DELETE /users/me` (тело `{password}`); раздача `/media/avatars/<uuid>.<jpg|png|webp>`; коды ошибок `code` в ответах `/user/*`; 429 с `Retry-After` на загрузку аватара, смену email/пароля и удаление.
- **Изменено:** `POST /uploads/avatar` → `{success, avatarUrl, key, user}`, лимит 5 МБ (было 2), 413/415/400/503 вместо 500; `DELETE /users/me/avatar` → `{success, avatarUrl:null, user}`; `PATCH /user/email` теперь требует `currentPassword`; `PATCH /user/username` строже; `GET /users/:id` не отдаёт чужой email; `avatarUrl` — URL или `null` везде (раньше placeholder на `placehold.co` в `/friends`, `/friends/search`, `/users/:id`); любой защищённый маршрут отвечает 401 `ACCOUNT_DELETED`, если аккаунт удалён.
- **Удалено (небезопасно):** `PATCH /user/update` (менял пароль без текущего), `GET /user/list` (email всех пользователей), `DELETE /user/delete` (без пароля, падал на внешних ключах), `PATCH /users/me/avatar` (позволял указать чужую ссылку/файл).
- Аватары хранятся в БД относительным путём и становятся абсолютными по адресу, с которого пришёл запрос (переживает смену IP); на R2 остаётся абсолютный CDN‑URL.

### 12.4 Проверки
`tsc` фронт и бэкенд 0 ошибок · `npm test` фронт **67/67**, бэкенд **22/22** · интеграционные тесты бэкенда **21/21** (отдельная БД `splitter_test`: `npm run test:db`, `npm run test:integration`) · `check:i18n` 365 ключей, 0 пропусков · `expo-doctor` 21/21 · ESLint 0 ошибок, 62 предупреждения (было 87 — старый экран профиля удалён) · `expo export` iOS и Android собираются · curl по LAN‑адресу — 26 запросов сценария (раздел выше), тестовый аккаунт удалён.

### 12.5 Не проверить без телефона 📱
Внешний вид экранов и тёмной темы; фото из галереи/камеры и системные запросы разрешений; кадрирование (`allowsEditing`) и HEIC→JPEG на реальном снимке; прогресс загрузки; клавиатура и фокус по `returnKeyType`; VoiceOver; Dynamic Type; Reduce Motion; хаптики; системное меню «Поделиться» и файл экспорта; сканирование QR камерой; поведение без сети.

### 12.6 Решения, которые нужны от вас
1. **Тексты политики конфиденциальности и условий** — это черновики (помечены «Draft text»), нужен юрист/ваш текст; адрес обратной связи `support@example.com` (`src/shared/config/app-info.ts`) — заглушка.
2. **Удаление аккаунта**: чужие общие счета сохраняются, имя заменяется на «Deleted user», служебный пользователь `deleted-user@splitter.invalid`. Альтернатива — удалять и общие счета (ломает историю других).
3. **Токены не отзываются при смене пароля** (JWT живёт 7 дней): для отзыва нужно поле в БД (миграция) — по вашему правилу не делал.
4. **Ключи R2 для production**: без них аватары лежат на диске сервера (на Docker/PaaS диск обычно временный — нужен том или R2); задайте `PUBLIC_BASE_URL`.
5. **Тёмная тема для старых экранов** (друзья, группы, скан, история) — отдельная задача.
6. **Переводы** (японский/узбекский, мои, не носителя) — особенно длинные тексты политики/условий и предупреждения об удалении аккаунта; проверьте носителем.
7. Face ID — только в development‑сборке (EAS), в Expo Go невозможен.

---

## 13. Сканирование чека: переработка (ветка feature/scan-receipt)

Аудит «до» и спецификация экранов: `docs/scan-redesign.md`. **Схема БД менялась**: одна новая таблица `ScanRequest` (миграция `20261021034537_add_scan_request`, откат — `down.sql` рядом, `DROP TABLE "ScanRequest"`; применена к `splitter_test` и к dev‑БД; при удалении аккаунта записи удаляются каскадом).

Проверка: **З** — запуском, **К** — только чтением кода, **📱** — нельзя проверить без телефона.

### 13.1 Функции

| Функция | Статус | Как проверено |
|---|---|---|
| Квота на пользователя (скользящие окна 24 ч / 30 сут, `SCAN_LIMIT_DAILY`=10, `SCAN_LIMIT_MONTHLY`=100), `GET /sessions/scan/quota` → `remaining, limit, resetAt, daily, monthly` | ✅ | **З** 8 unit‑тестов (внутри, на границе, превышение, сброс, оба окна, нулевой лимит) + интеграционные + curl |
| Исчерпание → 429 `QUOTA_EXCEEDED` с `resetAt`, **до** вызова ИИ | ✅ | **З** интеграционный тест и curl (лимит 1: второй снимок → 429, платного вызова нет) |
| Кэш по SHA‑256 снимка (на пользователя, 30 дней): повтор не вызывает ИИ и не списывает квоту; хранится только результат разбора и хэш, **фото не хранится** | ✅ | **З** тест (счётчик вызовов ИИ не растёт, квота та же) + curl на реальном файле |
| `Idempotency-Key`: повтор возвращает сохранённый ответ; двойной тап (два параллельных запроса) = один платный вызов | ✅ | **З** интеграционные тесты + curl |
| Дешёвые проверки до ИИ: magic bytes, размер (≤3 МБ → 413), минимум 320 px, максимум 8000 px, пустой/чёрный JPEG (эвристика «байт на пиксель»), битый заголовок. Некорректный ввод квоту не тратит | ✅ | **З** unit‑ и интеграционные тесты (5 причин `reason`), curl |
| Один запрос к Gemini на чек, `maxOutputTokens` 8192, строгая схема (`responseSchema` + zod), повтор **один** раз и только при сетевой ошибке; ключ в заголовке, не в URL | ✅ | **З** 1 реальный платный вызов (200, 9,5 с); логика повтора — **К** (сетевой сбой не воспроизводился) |
| Поля разбора: позиции (название, кол‑во, цена, сумма строки, уверенность), налог, чаевые/сервис, скидка, итог, валюта, дата, заведение, язык | ✅ | **З** тест на моке и реальный ответ (4 позиции, валюта USD, итог, без предупреждений) |
| Нормализация чисел (`1 234,50`, `1.234,50`, `1,234.50`, `45 000`, символы валют), JPY/UZS/KRW… без дробной части | ✅ | **З** unit‑тесты `scanMath` (8 тестов) |
| Сверка `позиции + налог + чаевые − скидка` с итогом чека: при расхождении `warnings:[{code:"TOTAL_MISMATCH", expectedMinor, computedMinor, differenceMinor}]`, данные **не правятся молча** | ✅ | **З** unit + интеграционный тест |
| Ручной путь: `POST /sessions` и `/finalize` валидируют суммы (≥0, только скидка может быть <0), количество (целое ≥1), названия, ≤200 позиций, ≤50 участников; без ИИ и квоты | ✅ | **З** unit + интеграционный тест + curl (400 `INVALID_ITEMS`) |
| Коды ошибок: `INVALID_IMAGE`(+`reason`), `IMAGE_TOO_LARGE`, `QUOTA_EXCEEDED`, `AI_UNAVAILABLE`, `NOT_A_RECEIPT`, `PARSE_FAILED`, `REQUEST_IN_PROGRESS`, `INVALID_REQUEST`; клиент переводит по коду | ✅ | **З** тесты бэкенда и таблица кодов во фронтенд‑тесте (en/ja/uz) |
| Журнал расходов без персональных данных (`{"scan":"ai_call"|"cache_hit"|…}`) и `npm run scan:usage` | ✅ | **З** скрипт запускается; содержимое чеков в лог не попадает — **К** |
| Экран «Новый чек»: три равные карточки (фото — с остатком «осталось N сегодня/в этом месяце», галерея, ручной ввод); при офлайне / исчерпании / 503 карточки ИИ блокируются с объяснением, ручной ввод всегда доступен; карточка «Незавершённый чек» | ✅ код | **З** тесты `getScanOptions` и состояний; внешний вид 📱 |
| Камера: рамка, подсказка, фонарик, затвор с хаптиком, галерея, закрыть; разрешения: сначала объяснение, при отказе — «Открыть настройки» | ✅ код | **К**, `tsc`, сборка; 📱 |
| Предпросмотр: переснять/выбрать другое, поворот 90°, обрезка по рамке, пояснение «потратит 1 распознавание»; HEIC→JPEG, длинная сторона ≤1280, JPEG 0,6, тело <2,5 МБ | ✅ код | **З** тесты геометрии кадрирования и `fitSize`; манипулятор/HEIC на реальном снимке — 📱 |
| Обработка: этапы (загрузка → чтение → проверка сумм), реальная «Отмена» (AbortController), «дольше обычного» через 20 с, таймаут 130 с, ошибки по коду с «Повторить / Другое фото / Ввести вручную» | ✅ код | **З** тесты конечного автомата (в т.ч. «поздний ответ после отмены не оживляет попытку»); сеть — curl; 📱 |
| Проверка чека: заведение, дата, валюта (пересчёт минимальных единиц при смене), правка на месте (название, степпер, цена), свайп‑удаление + «Отменить», добавить позицию, подсветка позиций с низкой уверенностью, налог/чаевые/скидка суммой или %, итог мгновенно, плашка расхождения («Исправить автоматически» добавляет разницу отдельной строкой или в скидку / «Править вручную»), поле «Итог на чеке» | ✅ код | **З** 14 тестов расчётов в целых минимальных единицах (100/3, 1/7, скидка, налог, чаевые, JPY, сверка, автоисправление); интерфейс 📱 |
| Черновик: сохраняется в AsyncStorage при каждой правке, переживает сворачивание/перезапуск, очищается после сохранения счёта | ✅ код | **К**; перезапуск 📱 |
| Ручной ввод: крупные поля, Enter в цене = добавить и вернуть фокус в название, количество, список со свайпом, итог, далее — тот же экран проверки | ✅ код | **К**, `tsc`; клавиатура 📱 |
| Дальше без изменений: участники → распределение → итоги; налог/чаевые/скидка идут отдельными строками и по умолчанию делятся поровну между всеми участниками; сессия на сервере создаётся на последнем шаге | ✅ код | **З** тест: сумма строк = итог; создание сессии + finalize — curl; сквозной проход 📱 |
| Приватность: временные файлы удаляются до отправки (байты только в памяти), тела запросов/ответов скана не логируются, надпись «Фото отправляется для распознавания и не хранится» | ✅ | **К** (+ редакция лога в интерсепторе) |
| Доступность: роли/подписи, цели ≥44 pt, `maxFontSizeMultiplier`, действие VoiceOver «Удалить» для строки, Reduce Motion, `KeyboardAvoidingView`, decimal‑pad (number‑pad для JPY/UZS) | ✅ код | **К**; VoiceOver/Dynamic Type 📱 |
| i18n en/ja/uz: 141 новый ключ, ошибки по коду, плюрализация, одинаковые плейсхолдеры | ✅ | **З** `check:i18n` (472 ключа, 0 пропусков) + тест динамических ключей и плейсхолдеров |

### 13.2 Коммиты (от `feature/profile-settings`)

- `641d630` docs: scan-receipt audit table and redesign spec
- `9b8cd62` feat(db): ScanRequest table for scan quota, cache and idempotency (reversible, no photos stored)
- `e6729cb` feat(scan): pure helpers for image checks, number normalisation, total reconciliation and rolling quota (with tests)
- `4bdfbbd` feat(scan): quota, hash cache, idempotency, strict single-call Gemini client, error codes; bill input validation
- `dac5fda` test(scan): integration tests with a mocked AI
- `2a65eae` feat(scan): pure client logic for the new receipt flow … (в этот коммит попало и удаление старого `scan-receipt.tsx`)
- `28ce79a` feat(scan): new receipt flow — entry with quota, camera, preview, processing with cancel, review/edit, manual entry; lazy session creation; i18n en/ja/uz

### 13.3 Что изменилось в API
- **Добавлено:** `GET /sessions/scan/quota`; заголовок `Idempotency-Key` (8–100 символов `[A-Za-z0-9_-]`); коды `code` в ошибках скана; rate‑limit 20 запросов/мин на скан; в ответ CORS добавлен `Idempotency-Key`.
- **Изменено (ломает старый клиент):** `POST /sessions/scan` принимает `{image:{mimeType,data}, language?, currency?}` и отвечает `{receipt, cached, replayed, quota}`; суммы — **целые минимальные единицы** (центы; целые единицы для JPY/UZS…); налог/чаевые/скидка — отдельные поля, а не «позиции»; **сессия при скане больше не создаётся** (её создаёт клиент через `POST /sessions` на последнем шаге); `sessionName` не нужен. `POST /sessions` и `/finalize` отвечают 400 `INVALID_REQUEST`/`INVALID_ITEMS`/`INVALID_PARTICIPANTS`; слишком большое тело → 413 `IMAGE_TOO_LARGE`.
- **Удалено:** перебор моделей и `v1beta`, `source:"mock"`, `DEBUG_PARSE`, `ALLOW_MOCK_OCR`, пакет `@google/generative-ai`. Для тестов — `ALLOW_MOCK_SCAN=true` (бесплатная имитация, заголовок `X-Mock-Ai`).
- Новые переменные: `SCAN_LIMIT_DAILY`, `SCAN_LIMIT_MONTHLY`, `SCAN_CACHE_DAYS`, `SCAN_MAX_IMAGE_BYTES`, `GEMINI_MODEL_PARSE` (по умолчанию `gemini-3.5-flash`) — см. `.env.example`.

### 13.4 Расход ИИ при проверке
**Реальных платных вызовов Gemini: 1** (curl, снимок `receipt.jpg` 60 КБ → 200 за 9,5 с, 4 позиции). Остальное (повтор, ключ идемпотентности, 429, невалидный файл) обошлось без вызовов — это и проверялось. Все автотесты идут на моке (0 вызовов). Цена вызова мной не измерялась и не проверялась.

### 13.5 Проверки
`tsc` фронт и бэкенд 0 ошибок · `npm test` фронт **90/90**, бэкенд **46/46** · интеграционные тесты бэкенда **37/37** (21 профиль + 16 скан) · `check:i18n` 472 ключа, 0 пропусков · `expo-doctor` 21/21 · ESLint 0 ошибок, 60 предупреждений (в новых файлах и в изменённых — без новых; единственное из затронутых каталогов — старое в `ItemEditModal.tsx`) · `expo export` iOS и Android собираются · curl по LAN‑адресу `10.200.88.238:3001` — 14 проверок (раздел 13.1), тестовый аккаунт удалён.

### 13.6 Не проверить без телефона 📱
Съёмка и фокус камеры, фонарик, сопоставление рамки на экране с кадром (**предположение: превью камеры показывается в режиме «cover»** — если обрезка по рамке выходит смещённой, переключатель «Обрезать по рамке» выключается, и берётся весь снимок); HEIC→JPEG и качество текста при 1280 px/0,6 на реальном чеке; свайп‑удаление (жест); клавиатура/фокус (Enter в цене, `automaticallyAdjustKeyboardInsets`); черновик после реального перезапуска приложения; «Открыть настройки» при отказе камеры; офлайн‑режим; VoiceOver, Dynamic Type, Reduce Motion, хаптики; тёмная тема новых экранов.

### 13.7 Ограничения и решения, принятые мной
- **Что списывает квоту:** вызов, дошедший до модели (успех, `NOT_A_RECEIPT`, `PARSE_FAILED`). Не списывает: невалидный файл, кэш, повтор по ключу, `AI_UNAVAILABLE`. Если отменить запрос на клиенте, сервер может всё равно дойти до конца и списать.
- Окна **скользящие** (не «до полуночи»): `resetAt` — когда истечёт самый старый засчитанный вызов.
- Защита от двойного тапа/гонок квоты — **блокировка на пользователя внутри одного процесса** сервера; при нескольких экземплярах нужна блокировка в БД. Rate‑limit тоже в памяти.
- Эвристика «пустой снимок» работает только для JPEG (клиент всегда шлёт JPEG); PNG/WebP проверяются на размер и заголовок.
- Черновик (текст и суммы чека, не фото) лежит в AsyncStorage без шифрования; результат разбора на сервере хранится `SCAN_CACHE_DAYS` дней.
- Дата чека вводится текстом `YYYY-MM-DD` (нативный выбор даты не входит в Expo Go без доп. пакета).
- Количество вроде 0,35 кг превращается в 1 позицию на сумму строки (приложение делит целые единицы).
- Новые маршруты открываются через `as never`, пока dev‑сервер не перегенерирует типы роутера.
- Старые экраны (друзья, группы, история) по‑прежнему частично в светлой теме.
- **Расхождение с вашим описанием:** в `splitter-backend-main/.env` переменной `GEMINI_MODEL_PARSE` **нет** (есть DATABASE_URL, DEBUG_PARSE, GEMINI_API_KEY, JWT_SECRET, NODE_ENV, PORT); модель берётся по умолчанию из кода — `gemini-3.5-flash`. `DEBUG_PARSE` в `.env` больше ничего не делает.

### 13.8 Решения, которые нужны от вас
1. **Лимиты:** по умолчанию 10 в сутки и 100 в месяц на пользователя — подходят ли? Нужен ли разный лимит для разных пользователей/тарифов?
2. **Хранение фото:** сейчас фото не хранится нигде (только хэш и текст результата, 30 дней). Хранить ли оригинал (для спорных случаев, переобучения, повторного разбора)? Это персональные данные: нужны политика и срок.
3. **Модель и цена Gemini:** оставить `gemini-3.5-flash` или выбрать более дешёвую? Цену за вызов проверьте в консоли Google AI — я её не измерял; ориентир для оценки — `npm run scan:usage` (число платных вызовов).
4. Делить налог/чаевые поровну между участниками (сейчас) или пропорционально съеденному?
5. Нужен ли «потолок на всё приложение» (общий дневной бюджет), а не только на пользователя?
6. Переводы ja/uz мои, не носителя — особенно тексты ошибок и объяснения лимитов.
