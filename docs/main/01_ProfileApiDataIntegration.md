# Target Profile API 데이터 연동 구성 가이드

소스 시스템(캠페인, CRM, CDP, 데이터 웨어하우스 등)의 고객 속성을 Adobe Target 프로필로 넣는 방법을 정리한다.

특정 워크플로우 엔진이나 워커 개수에 묶이지 않는다. 어떤 런타임으로 재구성하든, 공식 API 계약과 아래 확인 항목만 맞으면 연동할 수 있다.

기준 문서 (Experience League, 확인일 2026-08-19):

- [Update profiles](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-api-overview)
- [Bulk Profile Update API](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-bulk-api)
- [How Do I Get Data into Target Using the Bulk Profile Update API?](https://experienceleague.adobe.com/en/docs/target-dev/developer/implementation/methods/bulk-profile-update-api)
- [Single Profile Update API](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-single-api)
- [Fetch profiles](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-fetch)
- [Adobe Target Profiles API overview](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profiles-api)
- [Profile API settings](https://experienceleague.adobe.com/en/docs/target-dev/developer/implementation/methods/profile-api-settings)
- [Target limits](https://experienceleague.adobe.com/en/docs/target/using/troubleshoot/target-limits)

---

## 1. 무엇을 연동하는가

Adobe Target은 방문자마다 프로필을 두고, 그 속성으로 오디언스·활동을 결정한다.

페이지(at.js, Web SDK)에서 보내는 값만으로는 부족한 데이터가 있다. CRM 등급, 멤버십, 오프라인 세그먼트, 콜센터 이력처럼 **웹에 없는 속성**을 서버에서 Target으로 밀어 넣는 것이 이 연동의 목적이다.

연동의 최소 단위는 다음 세 가지다.

| 요소 | 질문 | 예 |
|---|---|---|
| 식별자 | Target이 같은 사람으로 인식하는 키는 무엇인가 | `mbox3rdPartyId`(멤버십 UID), 또는 Target `pcId` |
| 속성 | 프로필에 무엇을 쓰는가 | `seg_id`, `grade`, `vipYn` |
| 전송 수단 | 단건인가, 대량 배치인가, 페이지 이벤트인가 | Bulk API v2, Single API, Delivery/mbox |

속성은 Target UI에서 `profile.{paramName}`으로 보인다. Bulk 파일에는 `paramName`만 쓴다.

---

## 2. 전송 수단 선택

공식 경로를 먼저 고른다. 구현 프레임워크는 그 다음이다.

```
소스에 프로필로 넣을 데이터가 있다
  |
  v
실시간 단건인가?
  |-- 예, 웹/앱 세션 안      --> Delivery API / mbox / trackEvent
  |-- 예, 서버 단건 오프라인 --> Single Profile Update API
  +-- 아니오, 대량
        |
        v
      Analytics와 공유가 필요한가?
        |-- 예, ECID 기준  --> Customer Attributes FTP/HTTP
        +-- 아니오, Target 전용 --> Bulk Profile Update API
```

| 수단 | 공식 특징 | 맞을 때 | 맞지 않을 때 |
|---|---|---|---|
| Delivery / mbox | 세션 중 실시간. 페이지·앱 구현 | 지금 이 방문에 바로 써야 함 | 수백만 건 야간 적재 |
| Single Profile Update | 1명씩 GET/POST. 기존 프로필만 갱신. 생성 안 함. 24시간 100만 건 | 콜센터, 결제, 키오스크 같은 사건 단위 | 대량 적재, 미존재 프로필 생성 |
| Bulk Profile Update v1 | 배치 파일 POST. 기존 프로필만 갱신 | ECID 기반 구현에서 `pcId`를 키로 쓸 때 | 신규 프로필 생성, `thirdPartyId` 주력 |
| Bulk Profile Update v2 | 배치 파일 POST. 없으면 프로필 생성. 행 단위 상태 | 외부 ID로 대량 적재 | Analytics 공유, ECID를 `pcId` 키로 쓰는 경우 |
| Customer Attributes | FTP/HTTP 업로드. ECID + 소스 ID | Analytics와 속성 공유 | Target 단독, 빠른 HTTP 배치 |

이 가이드의 기본 경로는 **Bulk Profile Update API v2 + `thirdPartyId`** 이다. 식별자가 Target `pcId`이고 구현이 ECID를 쓰면 v1을 검토한다. 공식 문서: ECID 익명 식별에 `pcId`를 쓰면 v2 배치의 `pcId` 키를 쓰지 말 것.

---

## 3. Bulk API 공식 계약

재구성의 고정점이다. 워크플로우 모양은 달라도 이 계약은 같다.

### 3.1 엔드포인트

| 버전 | URL | 동작 |
|---|---|---|
| v1 | `http://{CLIENT_CODE}.tt.omtrdc.net/m2/{CLIENT_CODE}/profile/batchUpdate` | 기존 프로필만 갱신 |
| v2 | `http://{CLIENT_CODE}.tt.omtrdc.net/m2/{CLIENT_CODE}/v2/profile/batchUpdate` | 없으면 생성. 현재 권장 |

`CLIENT_CODE`는 Target UI **Administration > Implementation > Account Details** 에서 확인한다.

HTTPS를 쓰는 환경이 많다. 호스트와 path만 공식과 같으면 된다.

### 3.2 HTTP

```
POST
Content-Type: application/x-www-form-urlencoded
Body: 배치 파일 원문 (binary / data-binary)
Authorization: Bearer {token}    ← Require Authentication 이 켜진 경우만
```

공식 예시:

```bash
curl -X POST --data-binary @BATCH.TXT \
  http://CLIENTCODE.tt.omtrdc.net/m2/CLIENTCODE/v2/profile/batchUpdate
```

JSON이 아니다. multipart도 아니다. **파일 앞부분부터 `batch=`로 시작하는 텍스트**를 그대로 POST 한다.

Postman에서 실패하는 흔한 원인: `batch=` 누락, Content-Type 오설정, raw JSON 전송. 공식 KCS는 binary body + `application/x-www-form-urlencoded`를 요구한다.

### 3.3 배치 파일

```
batch=thirdPartyId,seg_id,grade
UID001,w10%7Cw32,gold
UID002,w01,silver
```

규칙:

1. 첫 토큰은 반드시 `batch=`.
2. 첫 컬럼은 `pcId` 또는 `thirdPartyId`만. Marketing Cloud Visitor ID(ECID)는 키로 쓸 수 없다.
3. `thirdPartyId`는 페이지/SDK에서 넘기는 `mbox3rdPartyId`와 같은 값이어야 한다. 파일에는 `thirdPartyId`로 적는다.
4. 이후 컬럼은 `paramName`. Target에서는 `profile.paramName`.
5. 파라미터와 값은 UTF-8 URL-encode. `|` 같은 구분자는 `%7C`.
6. 대소문자 구분.
7. v2는 빈 칸을 써도 된다. 없는 프로필은 생성한다.
8. v1은 없는 `pcId` / `mbox3rdPartyId`를 만들지 않는다.
9. 빈 값(`""`, null, 누락)은 기존 값을 지우지 않는다. 삭제 API는 없다(공식: 향후 v3에서 검토).
10. 빈 값만 있는 배치는 무시된다.
11. `mbox3rdPartyId`에 `+`와 `/`를 넣을 수 없다. 길이 한도는 256자.

### 3.4 응답 — 제출과 적재는 다르다

제출 응답 예:

```xml
<response>
  <success>true</success>
  <batchStatus>http://mboxedge45.tt.omtrdc.net/m2/demo/profile/batchStatus?batchId=...</batchStatus>
  <message>Batch submitted for processing</message>
</response>
```

`<success>true</success>`는 **큐에 넣었다**는 뜻이다. 프로필이 이미 쓰였다는 뜻이 아니다.

`batchStatus` URL을 GET 한다. `?showDetails=true`를 붙이면 건수 상세가 나온다. 단건 프로필 조회와 배치 내용 확인 방법은 `4. 조회 API`를 본다.

| status | 의미 |
|---|---|
| `complete` | 배치 처리 완료 |
| `incomplete` | 처리 중 |
| `stuck` | 멈춤. 완료되지 않음 |

상세 필드: `batchSize`, `consumedCount`, `successfulUpdates`, `profilesNotFound`, `failedUpdates`.

batchId 조회 유효 시간은 커뮤니티/샘플 기준 약 24시간. 운영에서는 제출 직후 URL을 저장해 두고 폴링한다.

### 3.5 가드레일 — 무엇을 재는가

이 저장소 파이프라인은 **Adobe Campaign → Target Bulk Profile Update API v2** 이다. 한 UID 행에 여러 `paramName`을 붙여 보낸다. 256자와 64KB는 같은 숫자가 아니다.

256자는 **한 행(UID)의 속성 합이 아니다.** 속성값 **칸 하나**의 한도다.  
64KB는 **그 사람 Target 프로필에 이미 쌓인 외부 데이터 전체**의 한도다. 이번 배치 한 줄만의 합이 아니다.

```
Campaign 한 행  (예: thirdPartyId = L0001)
  |
  +-- L0001 자체 (mbox3rdPartyId)     식별자 256자
  |
  +-- 컬럼마다 값 (합이 아님)
  |     seg_id        값 1개당 256자
  |     planName      값 1개당 256자
  |     phoneNumber   값 1개당 256자
  |     속성 이름     이름 1개당 128자
  |
  +-- 이 UID의 Target 프로필 전체
        예전에 Bulk로 넣은 값
      + 페이지(in-mbox)에서 넣은 값
      + 그 밖에 이미 붙어 있는 외부 프로필
        = 합쳐서 64KB
```

| 가드 | 범위 | 한도 | 출처 | 넘으면 |
|---|---|---|---|---|
| 프로필 값 | **속성 1개** | 256자. hard | Target limits (in-mbox / Delivery `profile` 파라미터) | at.js 1.x는 절단. at.js 2.x·Web SDK는 에러(자동 절단 없음) |
| 프로필 이름 | 속성명 1개 | 128자 | Target limits (in-mbox) | Delivery에서 거절 |
| `mbox3rdPartyId` | UID 1개 | 256자. `+` `/` 불가 | Bulk API + Target limits | 식별자 자체 오류 |
| 외부 프로필 합 | **방문자 1명, Target에 쌓인 전체** | 64KB | Bulk API | 이번 Campaign 행만 재지 않음. 이전 적재분도 포함 |
| 배치 파일 | Campaign이 한 번 POST하는 파일 | 50MB 미만, 500,000행 이하 | Bulk API | 제출 실패. 파일을 나눈다 |
| 호출 속도 | Target 계정 전체 Bulk/Admin/Reporting | 50회 / 분 | Target limits | HTTP 503 |
| 빈 값 | 칸 1개 | `""` / null / 누락 | Bulk API | 기존 `profile.*`를 지우지 않음. 삭제 API 없음 |
| v2 연속 전송 | 같은 `thirdPartyId` | 마지막 배치가 덮어씀 | Bulk API | mbox 없이 연속 v2면 앞 배치 속성이 사라질 수 있음 |

Bulk API 문서에는 **값당 256자 명시는 없다.** 256은 같은 `profile.{paramName}`을 웹 Delivery/mbox에서도 쓰고, 오디언스가 그 값을 볼 때의 hard limit이다. Campaign에서 300자를 넣어 Bulk가 받아도, 페이지가 같은 속성을 다시 보내면 256에서 끊기거나 에러가 난다. 오디언스 `equals`도 잘린 값과 원문이 갈린다.

재구성 시 값 가드는 **행 합이 아니라 컬럼마다** 건다. 샘플처럼 `planName` 50자, `phoneNumber` 11자면 256에 닿지 않는다. 긴 서술·JSON은 Target 프로필이 아니라 Campaign에 두고 코드만 보낸다.

침묵 절단(`substring(0,256)`)은 오디언스 정확도를 깎는다. 한도를 넘기면 그 칸을 비우거나(빈 값은 기존 유지) 행을 실패로 보는 편이 맞다.

배치 파일 50MB는 URL-encode **이후** 바이트다. 한글 등은 encode 후 길어지므로 행 수만 보지 않는다.

### 3.6 그 밖 공식 한도

| 항목 | 한도 | 출처 |
|---|---|---|
| 반영 시간 | 보통 1시간 이내, 최대 24시간 | Bulk API |
| 24시간 총 행 수 | 공식 상한 없음. 업무시간 throttling 가능 | Bulk API |
| 적재 보장 | 대량 배치에서 최대 약 0.1% 유실 가능 | Bulk API |

같은 Campaign→Target 경로의 단건은 Single Profile Update API다. 24시간 100만 갱신, GET 8KB / POST 60KB. **기존 프로필만 갱신하고 생성하지 않는다.** 야간 대량 적재의 대체 수단이 아니다.

---

## 4. 조회 API

쓰기는 Bulk/Single POST, 확인은 GET이다. 공식에는 **배치에 넣은 행 목록을 다시 받아오는 API가 없다.** 조회는 두 층만 제공한다.

| 층 | API | 얻는 것 | 얻지 못하는 것 |
|---|---|---|---|
| 배치 작업 | `batchStatus` GET | 그 제출의 처리 상태와 건수 집계 | 보낸 UID 목록, 행별 속성 원문 |
| 프로필 단건 | Profile Fetch GET | 한 식별자의 현재 프로필 JSON | 배치 단위 묶음, 실시간 확정 |

배치 “전체 내용”이 필요하면 Target이 아니라 **내가 보낸 파일·로그**가 원본이다. Target 쪽에서는 상태 집계 + 샘플(또는 전수) 단건 Fetch로 검증한다.

```
POST Bulk v2
  --> 응답의 batchStatus URL 저장
  --> GET batchStatus              작업이 끝났는가 (집계)
  --> (선택) GET batchStatus&showDetails=true
  --> GET Profile Fetch (식별자 1개)   속성이 실제로 붙었는가
  --> 전수가 필요하면 로컬에 남긴 ID마다 Fetch 반복
```

### 4.1 배치 상태 조회 — 제출한 작업 단위

Bulk POST 성공 응답의 `<batchStatus>` 가 조회 URL이다. 새로 조립하지 말고 **응답 URL을 그대로 GET** 한다. 호스트가 `CLIENT_CODE.tt.omtrdc.net`가 아니라 `mboxedgeNN.tt.omtrdc.net`일 수 있다.

```
GET {응답으로 받은 batchStatus URL}

GET {같은 URL}&showDetails=true
```

직접 만들 때의 형태(공식 예):

```
GET http://mboxedge45.tt.omtrdc.net/m2/{CLIENT_CODE}/profile/batchStatus?batchId={batchId}
GET http://mboxedge45.tt.omtrdc.net/m2/{CLIENT_CODE}/profile/batchStatus?batchId={batchId}&showDetails=true
```

`batchId`는 제출 응답 URL에 들어 있다. 샘플/커뮤니티 기준 조회 가능 시간은 제출 후 약 24시간. 운영에서는 URL과 batchId를 제출 직후 로그에 남긴다.

기본 응답 예:

```xml
<response>
  <batchId>demo4-1701473848678-13029383</batchId>
  <status>complete</status>
  <batchSize>1</batchSize>
</response>
```

`showDetails=true` 추가 필드:

| 필드 | 의미 |
|---|---|
| `status` | `complete` / `incomplete` / `stuck` |
| `batchSize` | 제출 행 수 |
| `consumedCount` | 처리기가 읽은 행 수 |
| `successfulUpdates` | 갱신 성공 수 |
| `profilesNotFound` | 프로필을 찾지 못한 수. v1에서 의미 있음. v2는 생성하므로 보통 0에 가깝다 |
| `failedUpdates` | 실패 수 |

`complete`여도 `failedUpdates > 0`일 수 있다. 어느 UID가 실패했는지는 이 API가 알려 주지 않는다. 실패한 식별자를 알려면 로컬 로그의 UID를 Fetch하거나, 소스와 대조한다.

인증이 켜져 있으면 이 GET에도 `Authorization: Bearer {token}`을 붙인다. 방화벽은 edge 호스트 GET을 허용해야 한다.

### 4.2 프로필 단건 조회 — Profile Fetch

공식: 식별자 종류는 세 가지. HTTP는 GET. 응답은 JSON. [Fetch profiles](https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-fetch)

| 키 | URL | 쓸 때 |
|---|---|---|
| `thirdPartyId` | `https://{CLIENT_CODE}.tt.omtrdc.net/rest/v1/profiles/thirdPartyId/{id}?client={CLIENT_CODE}` | Bulk/페이지의 `mbox3rdPartyId`와 같은 값. 이 가이드 기본 |
| `tntid` (pcId) | `https://{CLIENT_CODE}.tt.omtrdc.net/rest/v1/profiles/{tntid}?client={CLIENT_CODE}` | Target이 쿠키로 만든 방문자 ID |
| ECID | `https://{CLIENT_CODE}.tt.omtrdc.net/rest/v1/profiles/marketingCloudVisitorId/{ECID}?client={CLIENT_CODE}` | Experience Cloud Visitor ID |

`client` 쿼리는 필수다. path의 호스트 client code와 같은 값을 넣는다.

```
GET https://{CLIENT_CODE}.tt.omtrdc.net/rest/v1/profiles/thirdPartyId/{membershipUid}?client={CLIENT_CODE}
Authorization: Bearer {token}    ← Require Authentication 이 켜진 경우
```

응답 구조 (공식 Profiles API):

```json
{
  "client": "<client-code>",
  "visitorId": "a1-mbox3rdPartyId",
  "modifiedAt": "2017-08-18T17:53:39.003-04:00",
  "profileAttributes": {
    "seg_id": {
      "value": "w10|w32",
      "modifiedAt": "2017-08-09T18:18:04.659-04:00"
    }
  }
}
```

| 필드 | 의미 |
|---|---|
| `client` | Target client code |
| `visitorId` | 조회에 쓰인 식별자 (`tntid` / `thirdpartyid` / `marketingcloudvisitorid`) |
| `modifiedAt` | 프로필 마지막 갱신 |
| `profileAttributes.{name}.value` | 저장된 값. Bulk에서 보낸 `paramName` |
| `profileAttributes.{name}.modifiedAt` | 그 속성만의 갱신 시각 |

없는 ID, 만료된 프로필:

```json
{"status": 404, "message": "No profile found for client <client_code> with third party id=<third_party_id>"}
```

`tntid`로 못 찾으면 메시지에 `mboxPC=`가 나온다.

공식 참고:

- Profile Fetch는 **mbox 호출 수에 포함되지 않는다.**
- 인증을 켜면 모든 Profile API(쓰기·조회)에 토큰이 필요하다.
- Fetch는 방금 쓴 값의 실시간 뷰가 아니다. Bulk 반영 자체도 보통 1시간, 최대 24시간. 커뮤니티에서 Fetch 지연(수십 분)이 보고된다. 제출 직후 404이거나 이전 값이면 적재·복제 대기를 먼저 의심한다. 세션 실시간 확인은 mbox Trace / Delivery가 맞다.

### 4.3 배치 내용 전체를 보고 싶을 때

공식 API만으로는 “이 batchId에 들어 간 UID와 속성 전체”를 받을 수 없다. `showDetails`도 카운트만 준다.

| 목적 | 방법 |
|---|---|
| 내가 무엇을 보냈는가 | 로컬 배치 파일, 또는 Master/Detail 로그 |
| 작업이 끝났는가 | `batchStatus` → `complete` |
| 몇 건이 성공/실패인가 | `showDetails=true` |
| Target에 값이 붙었는가 | 샘플 UID Profile Fetch. `profileAttributes`와 로컬 페이로드 비교 |
| 전수 확인 | 로컬 ID 목록으로 Fetch를 반복. Target list/export API 없음 |

전수 Fetch는 호출 수가 배치 행 수와 같다. 50만 행을 한 번에 조회하지 않는다. QA는 샘플, 운영 감사는 구간 샘플 + 실패 카운트 알람이 현실적이다.

mbox 과금과 별개로, Admin/Reporting/Bulk는 분당 50회 한도가 있다. Fetch가 그 한도에 들어간다는 문구는 한도 문서에 없다. 대량 조회는 간격을 두고 호출하는 편이 안전하다.

### 4.4 조회 시 확인·세팅

확인:

- 조회 키가 쓰기 키와 같은가. Bulk를 `thirdPartyId`로 보냈으면 Fetch도 `thirdPartyId`. `tntid`로 조회하면 다른 프로필이거나 404다.
- 인증 on이면 Fetch·batchStatus에도 같은 Bearer 토큰인가.
- `batchStatus` URL의 edge 호스트가 열려 있는가.
- 404를 “미전송”으로 볼 것인가, “아직 미반영”으로 볼 것인가. SLA(최대 24시간)와 같이 정한다.

세팅:

- 제출 로그에 `batchStatus` URL, `batchId`, 로컬 배치명, 행 수.
- 검증 잡: 상태 폴링 → complete 후 샘플 N건 Fetch → 속성 비교.
- 전수 대조가 필요하면 소스/로그의 ID 커서로 Fetch. Target에 덤프를 요청하지 않는다.
- 조회용 client code·토큰을 쓰기와 같은 환경 설정에서 읽는다.

---

## 5. 인증

Target **Administration > Implementation > Profile API**:

1. `Require Authentication` on/off 확인.
2. on이면 `Generate New Profile Authentication Token`.
3. 요청 헤더: `Authorization: Bearer {token}`.
4. 토큰은 Expires In 기준으로 만료된다.
5. 재발급하면 이전 토큰을 쓰는 모든 호출이 실패한다.

토큰 발급 권한: Approver 이상, workspace/product admin, 또는 Target product sysadmin.

토큰을 코드에 하드코딩하지 말고, 런타임 시크릿(옵션, vault, 환경변수)으로 읽는다.

인증이 off여도 client code와 네트워크 경로만 맞으면 호출은 된다. 운영에서는 on을 전제로 설계하는 편이 안전하다.

---

## 6. 재구성 시 확인·세팅 — 흐름 순

구현 언어와 스케줄러는 자유다. 아래 순서로 결정하고 검증한다.

```
A 식별·속성
  --> B Target 계정
  --> C 소스 추출
  --> D 배치 조립
  --> E 전송·재시도
  --> F 상태·멱등
  --> G 검증·운영
```

### A. 식별자와 속성

확인:

- 웹/앱 Target 구현이 `mbox3rdPartyId`를 이미 보내는가. 보낸다면 그 값의 원천(멤버십 UID, CRM ID)은 무엇인가.
- 보내지 않는다면 Bulk로 만든 프로필과 이후 방문 프로필이 **합쳐지지 않는다**. 페이지 식별자 작업을 먼저 한다.
- 키는 `thirdPartyId`인가 `pcId`인가. ECID만 있으면 Customer Attributes를 검토한다.
- 속성은 몇 개이며, 멀티값은 어떤 구분자인가. 값 1개가 256자를 넘는가. 그 UID의 Target 프로필 전체(이전 Bulk·페이지 값 포함)가 64KB를 넘는가.
- 빈 값으로 기존 세그먼트를 지울 수 없다. “제거”가 필요하면 명시적 값(예: `NONE`)과 오디언스 규칙을 같이 설계한다.
- 같은 ID에 짧은 간격으로 두 번 보내면 뒤가 앞을 덮는다. 최종 상태만 보낼지, 병합 규칙을 소스에서 만들지 정한다.

세팅:

- 식별자 매핑표: 소스 PK → Target 키 타입 → 샘플 값.
- 속성 사전: 소스 컬럼 → `paramName` → 타입/인코딩/예시.
- 금지 문자 검사: `thirdPartyId`에 `+`, `/` 없음.

### B. Target 계정

확인:

- 환경별 client code (dev / stage / prod는 보통 다름).
- Profile API 인증 on/off, 토큰 만료.
- 속성을 소비할 오디언스·활동이 준비되어 있는가. 보내기만 하고 활동이 없으면 효과를 확인할 수 없다.
- edge 클러스터. `batchStatus` 호스트는 `mboxedgeNN`일 수 있다. 방화벽이 edge도 허용해야 한다.

세팅:

- client code, 토큰, 엔드포인트 URL을 환경 설정으로 분리.
- 오디언스: `profile.{paramName}` 조건 초안.
- 네트워크: `*.tt.omtrdc.net` POST/GET.

### C. 소스 추출

확인:

- 전체 스냅샷인가, 증분(미전송·변경분)인가.
- 추출 키가 정렬 가능한가. 대량은 커서/키셋이 오프셋보다 안전하다.
- 한 실행의 상한. 공식 배치당 50만 행 / 50MB를 넘기면 파일을 나눈다.
- 동시 실행 시 같은 ID가 두 배치에 들어가지 않는가.
- 개인정보. Target 프로필에 넣어도 되는 항목만 선택한다. 주민번호·카드번호는 넣지 않는다.

세팅:

- 추출 조건, 정렬 키, 페이지 크기, 실행 상한.
- 전송 여부 플래그 또는 워터마크(시점, 커서, 해시).
- 중복 제거 기준(식별자 unique).

프레임워크는 달라도 된다. 캠페인 워크플로우, Airflow, 배치 잡, 클라우드 함수, 어떤 것이든 **추출 → 배치 파일 → POST** 만 지키면 된다. 병렬 워커는 선택이다. 쓸 때는 ID 구간이 겹치지 않게 나눈다.

### D. 배치 조립

확인:

- 첫 줄 `batch=thirdPartyId,param1,...` 또는 `batch=pcId,...`.
- 값 URL-encode, 파일 UTF-8.
- 행 수 ≤ 500,000, 바이트 < 50MB.
- 빈 전용 배치가 나가지 않는가.

세팅:

- 파일 또는 메모리 버퍼 생성기.
- 사이즈 가드. 넘치면 다음 배치로 분할.
- 배치 ID(로컬). Target `batchId`와 별개로, 재처리·로그용 이름을 가진다.

### E. 전송과 재시도

확인:

- 분당 50회. 워커 수 × (60 / 배치주기)가 50을 넘지 않는가.
- 429/503/5xx는 재시도 가치가 있다. 400번대(포맷 오류)는 재시도해도 같은 결과가 나온다.
- `Retry-After`를 못 읽으면 고정 backoff.
- 업무시간 throttling. 대량은 오프피크를 기본으로 한다.

세팅:

- HTTP 클라이언트: POST binary, 타임아웃, TLS.
- 재시도 정책: 횟수, 대기, 대상 상태코드.
- 동시성 상한. 필요하면 글로벌 레이트 리미터.
- 인증 헤더 on/off를 설정으로 분기.

### F. 상태, 로그, 멱등

확인:

- 제출 성공만 커밋할 것인가, `batchStatus=complete`까지 보고 커밋할 것인가.
- complete여도 `failedUpdates` / `profilesNotFound`가 있을 수 있다. 상세 폴링을 쓸 것인가.
- 실패 행을 다음 실행에서 다시 집을 키(플래그, 큐, 실패 테이블).
- 같은 배치를 두 번 POST해도 안전한가. v2는 덮어쓰므로 **최종 상태 재전송**은 대체로 안전하다. 중간 상태를 이어 붙이는 설계는 안전하지 않다.

세팅:

- 제출 로그: 시각, 행 수, HTTP 코드, 응답 본문, `batchStatus` URL.
- 상태 로그: complete/incomplete/stuck, 상세 카운트.
- 소스 커밋: 성공 범위만 “전송됨”으로 표시. 제출 전 커밋 금지.
- 실패 보관: 요청 일부, 에러, 재처리 가능 여부.

권장 커밋 시점:

```
추출 → POST → success=true → batchStatus 폴링 → complete
  → (선택) showDetails로 실패 행 분리
  → 성공 범위만 소스 플래그 갱신
```

적재는 비동기이고 최대 24시간이다. 동기 확정이 필요하면 폴링 타임아웃과 “미확정” 상태를 따로 둔다.

### G. 검증과 운영

확인:

- 샘플 ID를 Profile Fetch / Visitor Profile로 조회했을 때 속성이 보이는가.
- 오디언스 진입 조건과 값이 일치하는가.
- QA는 소량(수십~수백) → 한도 근접 전에 rate limit 테스트.

세팅:

- 스모크: 1행 배치, 인증 on/off, 잘못된 `batch=` 실패 확인.
- 샘플 조회 절차와 담당.
- 알람: HTTP 실패율, stuck, 미확정 적체, 토큰 만료.
- 런북: 토큰 재발급, 중복 전송, 부분 실패 재처리.

조회 URL·응답·배치 전수 확인 한계는 `4. 조회 API`를 본다.

---

## 7. 플랫폼에 묶이지 않는 논리 골격

아래는 캠페인 Factory/Worker가 아니어도 같은 일을 하는 최소 골격이다.

```
추출: 미전송 또는 변경분
  |
  +-- 건수 0 --> 종료
  |
  +-- 건수 > 0
        |
        v
      한도 내로 분할 (행 / 바이트 / 분당 호출)
        |
        v
      배치 파일 조립  batch=...
        |
        v
      POST Bulk v2
        |
        +-- 재시도 대상 --> (다시 POST)
        +-- 포맷 오류   --> 실패 로그 / 중단 또는 건너뜀
        +-- 제출 성공
              |
              v
            batchStatus 폴링
              |
              +-- stuck / timeout --> 실패 로그 / 중단 또는 건너뜀
              +-- complete
                    |
                    v
                  상세 카운트 --> 성공 범위 커밋 --> (다시 추출)
```

병렬이 필요하면 “분할” 단계만 늘린다. 구간이 겹치지 않으면 워커 수와 엔진은 교체 가능하다.

단건 사건이 섞이면 Bulk 루프와 별도로 Single API 또는 Delivery를 쓴다. 한 파이프에 억지로 넣지 않는다.

---

## 8. 결정 체크리스트 (착수 전)

복사해서 프로젝트 설정에 채워 넣는다.

### Target

- [ ] client code (환경별)
- [ ] API 버전 v1 / v2
- [ ] 키 `thirdPartyId` / `pcId`
- [ ] 페이지의 `mbox3rdPartyId`와 소스 ID가 동일
- [ ] Profile API 인증 여부와 토큰 보관
- [ ] 사용할 `paramName` 목록과 오디언스
- [ ] edge 호스트 네트워크 허용

### 소스와 페이로드

- [ ] 추출 조건(전체 / 증분)
- [ ] 정렬·커서 키
- [ ] 배치 행 상한, 파일 크기 상한 (encode 후 50MB)
- [ ] 속성값 1개당 256자 (행 합 아님). 초과 시 침묵 절단 금지
- [ ] 방문자 1명 외부 프로필 합 64KB (이번 행만이 아님)
- [ ] URL-encode 대상 컬럼
- [ ] 빈 값 정책 (무시됨. 삭제 아님)
- [ ] `+` `/` 없는 식별자, UID 256자 이내

### 전송

- [ ] POST binary + `batch=` + form-urlencoded
- [ ] 분당 50회 가드
- [ ] 429 / 503 / 5xx 재시도
- [ ] 4xx 비재시도
- [ ] batchStatus 폴링 여부·타임아웃
- [ ] Profile Fetch 키 (`thirdPartyId` / `tntid` / ECID)가 쓰기 키와 동일

### 운영

- [ ] 성공 시에만 소스 커밋
- [ ] 제출 로그와 status URL, batchId 보관
- [ ] 부분 실패 재처리
- [ ] 토큰 만료 알람
- [ ] 샘플 프로필 조회 방법 (Fetch)
- [ ] 배치 전수는 로컬 로그가 원본. Target list API 없음
- [ ] 반영 SLA (1시간~24시간) 공유

---

## 9. 잘못된 구성으로 자주 깨지는 지점

| 증상 | 먼저 볼 곳 |
|---|---|
| `Batch is empty` / Unexpected Error | 본문이 `batch=`로 시작하는지, binary로 보내는가 |
| 200인데 속성이 없음 | 제출만 성공. status 미완료이거나 반영 대기(최대 24시간). 키 불일치 |
| Fetch 404 | ID 오타, 키 종류 불일치, 프로필 만료, 또는 적재 전. 즉시 미전송으로 단정하지 말 것 |
| batchStatus에 UID가 없음 | 공식은 집계만 반환. 행 목록은 로컬 로그 |
| 방문 프로필과 불일치 | 페이지 `mbox3rdPartyId` ≠ 파일 `thirdPartyId` |
| 503 | 분당 50회 초과 |
| 인증 실패 | Require Authentication on, 토큰 만료/재발급 |
| 오디언스 equals 불일치 | 값당 256 초과 후 절단·경로별 값 분기. 행 합 256이 아님 |
| 값이 지워지지 않음 | 빈 값은 삭제되지 않음. 설계 한계 |
| 이전 속성 사라짐 | 같은 ID 연속 v2. 마지막 배치가 덮어씀 |
| v2 + `pcId` + ECID | 공식 비권장. 키 전략을 다시 고른다 |

---

## 10. 이 저장소와의 관계

`old_ver`는 위 계약 중 **Bulk v2 + `thirdPartyId` + 배치 POST**를 Adobe Campaign 워크플로우로 구현한 한 사례다. Factory/Worker, Option 폴링, 랜덤 `seg_id`는 사례의 선택이지 API 요건이 아니다.

새로 구성할 때는 `old_ver/docs/logic.md`를 참고 구현으로만 보고, 이 문서의 공식 계약과 체크리스트를 기준으로 맞춘다.
