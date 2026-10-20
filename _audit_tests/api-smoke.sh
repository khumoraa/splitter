#!/bin/bash
B=${B:-http://127.0.0.1:3001}; J='Content-Type: application/json'; O=/tmp/claude-501/o
req(){ echo "## $1"; shift; curl -s -o $O -w "HTTP %{http_code}\n" "$@"; head -c 350 $O; echo; }
S=$RANDOM
req health $B/health
req "register weak pw" -X POST $B/auth/register -H "$J" -d '{"email":"a'$S'@t.io","password":"abc","username":"A"}'
req "register bad type" -X POST $B/auth/register -H "$J" -d '{"email":["x"],"password":"Aa1!aaaa","username":"A"}'
req "register no CT" -X POST $B/auth/register -d 'x'
req "register A" -X POST $B/auth/register -H "$J" -d '{"email":"a'$S'@t.io","password":"Aa1!aaaa","username":"Alice"}'
TA=$(grep -o '"token":"[^"]*' $O | cut -d'"' -f4); UA=$(grep -o '"uniqueId":"[^"]*' $O | cut -d'"' -f4)
req "register dup" -X POST $B/auth/register -H "$J" -d '{"email":"a'$S'@t.io","password":"Aa1!aaaa","username":"Alice"}'
req "register B" -X POST $B/auth/register -H "$J" -d '{"email":"b'$S'@t.io","password":"Aa1!aaaa","username":"Bob"}'
TB=$(grep -o '"token":"[^"]*' $O | cut -d'"' -f4); UB=$(grep -o '"uniqueId":"[^"]*' $O | cut -d'"' -f4)
req "login wrong pw" -X POST $B/auth/login -H "$J" -d '{"email":"a'$S'@t.io","password":"nope"}'
req "login ok" -X POST $B/auth/login -H "$J" -d '{"email":"a'$S'@t.io","password":"Aa1!aaaa"}'
req "me no token" $B/auth/me
req "me bad token" $B/auth/me -H "Authorization: Bearer abc"
req "me ok" $B/auth/me -H "Authorization: Bearer $TA"
req "users/1 NO AUTH" $B/users/1
req "friends request A->B" -X POST $B/friends/request -H "$J" -H "Authorization: Bearer $TA" -d '{"uniqueId":"'$UB'"}'
req "friends list" $B/friends -H "Authorization: Bearer $TA"
req "groups create" -X POST $B/groups -H "$J" -H "Authorization: Bearer $TA" -d '{"name":"G1"}'
GID=$(grep -o '"id":[0-9]*' $O | head -1 | cut -d: -f2)
req "groups list" $B/groups -H "Authorization: Bearer $TA"
req "scan (no gemini key)" -X POST $B/sessions/scan -H "$J" -H "Authorization: Bearer $TA" -d '{"sessionName":"s","language":"en","image":{"mimeType":"image/jpeg","data":"AAAA"}}'
SID=$(grep -o '"sessionId":[0-9]*' $O | head -1 | cut -d: -f2)
req "scan missing image" -X POST $B/sessions/scan -H "$J" -H "Authorization: Bearer $TA" -d '{"sessionName":"s","language":"en"}'
req "finalize ok" -X POST $B/sessions/finalize -H "$J" -H "Authorization: Bearer $TA" -d '{"sessionId":'$SID',"sessionName":"s","currency":"USD","participants":[{"uniqueId":"'$UA'","username":"Alice"},{"uniqueId":"'$UB'","username":"Bob"}],"items":[{"id":"1","name":"Pizza","price":10,"quantity":1,"splitMode":"equal","assignedTo":["'$UA'","'$UB'"]},{"id":"2","name":"Beer","price":0.1,"quantity":3,"splitMode":"count","perPersonCount":{"'$UA'":1,"'$UB'":2}}]}'
req "finalize unassigned" -X POST $B/sessions/finalize -H "$J" -H "Authorization: Bearer $TA" -d '{"sessionId":'$SID',"participants":[{"uniqueId":"'$UA'"}],"items":[{"id":"1","name":"P","price":10,"quantity":1,"splitMode":"equal","assignedTo":[]}]}'
req "finalize by other user" -X POST $B/sessions/finalize -H "$J" -H "Authorization: Bearer $TB" -d '{"sessionId":'$SID',"participants":[{"uniqueId":"'$UB'"}],"items":[{"id":"1","name":"P","price":10,"quantity":1,"splitMode":"equal","assignedTo":["'$UB'"]}]}'
req "history as Bob" "$B/sessions/history" -H "Authorization: Bearer $TB"
req "sessions?groupId as Bob (authz)" "$B/sessions?groupId=$GID" -H "Authorization: Bearer $TB"
req "debug/gemini NO AUTH" $B/debug/gemini
req "CORS preflight" -X OPTIONS $B/auth/login -H "Origin: http://x.example" -H "Access-Control-Request-Method: POST"
