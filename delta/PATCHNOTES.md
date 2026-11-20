# PATCHNOTES: 원본이 언젠가 고칠 수 있는 수정

Delta의 변경은 두 가지로 나눈다. **기능**(원본에 없는 것)은 플러그인(`delta/plugins/`)과 연결 지점(seam,
[LOCAL_PATCHES.md](LOCAL_PATCHES.md))으로 붙이고 계속 유지한다. **버그 수정**은 이 문서에 모은다.

Delta가 원본 동작을 바꾸는 **수정**을 모은다. 원본이 같은 문제를 고치면 Delta 쪽 수정은 필요 없어지므로,
**원본 버전을 올릴 때마다 항목마다 다시 검토**한다. 기능 확장을 위한 연결 지점(seam)은
[LOCAL_PATCHES.md](LOCAL_PATCHES.md)에 따로 있다.

- 기계가 읽는 목록: [delta.json](delta.json)의 `hotfixes`, `pending`
- 지금 상태: `node delta/scripts/delta.mjs status`의 `hotfix`, `pending` 줄
- 원본 업데이트 검토: `node delta/scripts/delta.mjs review [<태그>]` → `delta/reviews/<기준>..<태그>.md`

## 두 종류

| 종류              | 커밋              | 원본 파일 표시             | 언제 빠지나                                                             |
| ----------------- | ----------------- | -------------------------- | ----------------------------------------------------------------------- |
| **직접 수정 (H)** | `hotfix(H1): …`   | 고친 줄에 `[delta-fix:H1]` | 검토에서 사람이 `"status": "retired"`로 정하면 다음 `sync`가 뺀다       |
| **임시 패치 (P)** | `pending(#PR): …` | 원본 PR 그대로라 표시 없음 | 원본 PR의 머지 커밋이 새 정식 태그에 들어 있으면 `sync`가 자동으로 뺀다 |

원본에 쓸 만한 PR이 있고 작으면 P로 가져온다. PR이 없거나, 크거나, 충돌이 잦을 것 같으면 H로 최소한만 고친다.
스택 순서는 기준 태그부터 pending → hotfix → seam → delta다.

## 원본을 올릴 때

1. `node delta/scripts/delta.mjs review`로 보고서를 만든다(새 정식 릴리스가 없으면 `--nightly`로 미리 본다).
2. 보고서 "Delta에 미치는 영향"에서 항목마다 판단을 본다.
   - "원본 PR이 새 태그에 들어 있음 → 빼기 권장", "원본 이슈가 해결로 닫힘": 새 태그에서 증상이 없어졌는지 확인하고 빼기로 한다.
   - "같은 문제를 다룬 원본 커밋이 있음": 커밋 내용을 읽고 결정한다.
   - "관련 파일만 바뀜": 유지한다. 동기화 때 충돌이 날 수 있다.
3. 뺄 H는 `delta.json`에서 `"status": "retired"`로 바꾸고 `delta: retire H1 (…)`로 커밋한다.
4. `node delta/scripts/delta.mjs sync`. 빠진 항목은 아래 "지난 수정"으로 옮기고, 보고서 링크를 "검토 기록"에 남긴다.

## 지금 수정

### H1. 단일 틸드(~)가 취소선이 됨

| 항목                  | 내용                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 증상                  | 에이전트 답변의 `1~2줄 … 3~5개`처럼 틸드가 두 개 있으면 두 틸드가 사라지고 그 사이가 취소선이 된다                                                                                                                |
| 원인                  | 채팅 Markdown이 remark-gfm 기본값(`singleTilde: true`)을 쓴다. 사용자 메시지만 원본 [#35859](https://gh.ali360.cloudns.ch/pingdotgg/t3code/pull/35859)로 고쳐졌다                                                 |
| 원본 추적             | 이슈 [#29254](https://gh.ali360.cloudns.ch/pingdotgg/t3code/issues/29254) (open) · PR [#29270](https://gh.ali360.cloudns.ch/pingdotgg/t3code/pull/29270) (open, 파일 9개, main과 충돌, 메인테이너 제품 결정 대기) |
| 수정                  | `packages/shared/src/markdownPipeline.ts`의 채팅 플러그인 목록 두 곳에서 `remarkGfm` → `[remarkGfm, { singleTilde: false }]`. 이 동작을 고정하던 원본 테스트 2곳의 기대값을 바꿨다                                |
| 범위                  | 에이전트 답변, Markdown 파일 미리보기, PR 본문, 스레드 검색. `~~두 개~~`는 그대로 취소선. 타임라인 미니맵 미리보기와 모바일 앱은 원본 그대로                                                                      |
| 왜 PR #29270이 아닌가 | 파일 9개를 고치고 이미 main과 충돌한다. 에이전트 답변에 플러그인을 따로 넘기면 스트리밍 최적화가 꺼진다. 공용 목록 2줄이 충돌 면적이 가장 작다                                                                    |
| 빼는 조건             | 원본이 #29254를 고친 정식 릴리스. `review`가 PR #29270 머지와 `tilde`·`strikethrough` 커밋을 찾아 준다                                                                                                            |
| 확인 방법             | 에이전트에게 "1~2줄, 3~5개"가 든 답을 하게 하고 취소선이 없는지 본다. 테스트: `packages/shared`의 `markdownPipeline`, `apps/web`의 `MessagesTimeline.browser` "single tildes"                                     |
| 알려진 충돌           | 원본 nightly(2026-11-20)가 `MessagesTimeline.browser.test.tsx`를 바꿔서, 다음 동기화 때 이 테스트 파일에서 충돌이 난다. 원본 테스트를 받고 단일 틸드 기대값만 다시 바꾼다                                         |

### H2. Antigravity(Gemini) 사용량이 집계되지 않음

| 항목           | 내용                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 증상           | Usage 화면에 Antigravity(Gemini 모델) 사용량과 비용이 빠진다. 한도 막대(P2)와는 별개 문제다                                                                                                                                                                                                                                                                                         |
| 원인           | 사용량 스캐너(`apps/server/src/provider/Drivers/AntigravityUsage.ts`)가 T3가 관리하는 Antigravity 프로필(`<T3 홈>/userdata/providers/antigravity/<sha256(인스턴스 id)>/antigravity-acp`)을 설정에 직접 추가한 인스턴스(`configured`)만 읽는다. 기본 인스턴스 `antigravity`로 쓰면 대화 기록이 그 폴더에만 있어서 하나도 집계되지 않는다                                             |
| 이 PC에서 확인 | 공식 앱 프로필에 최근 30일 기록 324건(입력 약 460만, 캐시 입력 약 6,600만, 출력 약 48만 토큰)이 있는데, 공식 앱 사용량 캐시에는 Antigravity가 0건이었다. 폴더 이름이 `sha256("antigravity")`와 같다                                                                                                                                                                                 |
| 원본 추적      | 없음. 원본 main과 nightly 20261120.4969에도 같은 조건이 있다. 비슷하지만 다른 원인: #31298(서브에이전트 호출 누락), #39429(PR #39435로 해결)                                                                                                                                                                                                                                        |
| 수정           | 기본 인스턴스의 관리 프로필도 있으면 스캔한다. 없으면 출처 목록에 넣지 않는다(원본의 별칭 중복 제거 테스트 유지). 테스트 `AntigravityUsage.test.ts`를 추가했다                                                                                                                                                                                                                      |
| 범위           | Delta 서버의 사용량. Delta는 T3 홈이 따로(`~/.t3-delta`)라 Delta에서 돌린 세션이 집계된다. 공식 앱의 지난 기록까지 보려면 Delta의 Antigravity 프로바이더 환경 변수에 `ANTIGRAVITY_DATA_DIR=~/.t3/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32/antigravity-acp,~/.gemini/antigravity-cli`를 넣는다. 사용량 스캔에만 쓰이는 변수다 |
| 빼는 조건      | 원본이 기본 인스턴스 프로필을 스캔하도록 고친 정식 릴리스. `review`가 `AntigravityUsage.ts`·`UsageService.ts` 변경과 "Antigravity usage" 커밋을 찾아 준다                                                                                                                                                                                                                           |
| 확인 방법      | Delta에서 Antigravity로 대화한 뒤 Usage 화면에 Antigravity 토큰·비용이 보이는지. 테스트: `apps/server`의 `AntigravityUsage`                                                                                                                                                                                                                                                         |

### P2. Antigravity 한도: 1.5.x CLI 로그인 읽기

| 항목      | 내용                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| 증상      | Usage의 Antigravity 한도가 "Sign in with Google to see Antigravity limits"에서 멈춘다                                       |
| 원인      | 한도 코드가 `acp_token.json`만 읽는데, 1.5.x CLI는 로그인을 OS 키링(Windows는 자격 증명 관리자 `gemini:antigravity`)에 둔다 |
| 원본 추적 | PR [#38957](https://gh.ali360.cloudns.ch/pingdotgg/t3code/pull/38957) (2026-11-20 main 머지, `5283f33ca9`)                  |
| 상태      | 정식 릴리스 대기. nightly 20261120.4969에는 들어 있다                                                                       |
| 확인      | 이 PC에서 자격 증명을 읽는 것을 확인했다. 한계: T3가 이 토큰을 갱신하지 못해서, 만료되면 Antigravity 턴을 한 번 돌려야 한다 |
| 빼는 조건 | 자동. 다음 정식 릴리스에 들어 있으면 `sync`가 뺀다                                                                          |

### 선택 (적용 안 함)

| ID  | 원본 PR                                                            | 내용                                         |
| --- | ------------------------------------------------------------------ | -------------------------------------------- |
| P3  | [#34036](https://gh.ali360.cloudns.ch/pingdotgg/t3code/pull/34036) | Antigravity 사용량: 생성 1회만 집계          |
| P4  | [#31703](https://gh.ali360.cloudns.ch/pingdotgg/t3code/pull/31703) | Antigravity 사용량: 캐시 토큰 이중 집계 수정 |

## 지난 수정

| ID  | 원본                                                                  | 뺀 날      | 이유                                                                         |
| --- | --------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| P1  | PR [#36733](https://gh.ali360.cloudns.ch/pingdotgg/t3code/pull/36733) | 2026-11-20 | P2가 Windows 자격 증명 읽기(`CredReadW`)까지 포함해서 불필요. 적용한 적 없음 |

## 검토 기록

원본을 올릴 때마다 `delta/reviews/`의 보고서를 여기에 링크한다. nightly 미리 보기는 git에 넣지 않는다.

| 날짜 | 기준 → 새 원본 | 보고서 | 뺀 수정 |
| ---- | -------------- | ------ | ------- |
| —    | —              | —      | —       |
