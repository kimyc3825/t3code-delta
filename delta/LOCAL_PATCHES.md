# LOCAL_PATCHES: 원본 수정 목록

원본(pingdotgg/t3code) 파일을 건드리는 변경은 모두 여기에 등록한다. 원본 업데이트로 리베이스할 때
이 문서가 기준이다. **여기에 없는 원본 수정은 버그로 본다.**

- 기계가 읽는 목록은 [delta.json](delta.json)이다. 이 문서는 사람과 AI 에이전트를 위한 설명이다.
  둘이 다르면 `delta.json`을 기준으로 이 문서를 고친다.
- 현재 상태 확인: `node delta/scripts/delta.mjs status`
- 규칙 검사: `node delta/scripts/delta.mjs check` (등록 안 된 seam 표시, 누락된 seam, 커밋 규칙 위반을 잡는다)

## 규칙

- 연결 지점(seam)은 파일당 import 1줄과 사용 1줄을 목표로 한다. 로직은 `apps/web/src/delta/`에 둔다.
- 원본 파일에서 고친 줄에는 `[delta-seam:<ID>]` 주석을 단다. 주석을 달 수 없는 파일(예: `CLAUDE.md`)은
  `delta.json`의 `contains`로 확인한다.
- 기준점은 줄 번호가 아니라 의미(함수, JSX 요소)로 적는다. 원본이 줄을 옮겨도 다시 찾을 수 있게 하기 위해서다.
- 커밋은 seam 하나당 하나, 메시지는 `seam(<ID>): …`로 쓴다. 임시 패치는 `pending(#<PR>): …`로 쓴다.

## 연결 지점 (seam)

| ID | 상태 | 파일 | 기준점 | 변경 | 용도 |
|---|---|---|---|---|---|
| S0 | 적용 | `CLAUDE.md` | 파일 끝 | `@delta/AGENTS.md` 한 줄 추가 | Claude가 포크 규칙을 읽는다 |
| S1 | 예정 | `apps/web/src/routes/_chat.tsx` | `ChatRouteLayout`이 반환하는 fragment의 마지막 자식(닫는 `</>` 바로 앞) | `<DeltaSlot name="chat-layout" />`와 import | F1 전역 독 |
| S2 | 예정 | `apps/web/src/components/sidebar/SidebarChrome.tsx` | `SidebarChromeFooter`의 `<SidebarFooter>` 첫 자식 | `<DeltaSlot name="sidebar-footer" />`와 import | F2a usage 위젯 |
| S3 | 선택 | `apps/web/src/components/sidebar/SidebarThreadRow.tsx` | `data-sidebar-row`가 붙은 카드 요소(card·slim 두 곳) | `data-status`, `data-provider` 속성 | F3b |
| S4 | 예정 | `apps/desktop/src/app/DesktopEnvironment.ts` | `resolveDesktopAppBranding`이 반환하는 `displayName` | `"T3 Code - Delta"` | 창 제목과 앱 이름 |

메모

- **S0:** Codex 등 다른 에이전트는 `CLAUDE.md`가 아니라 루트 `AGENTS.md`를 읽는다. 루트 `AGENTS.md`는
  자주 바뀌어 seam을 두지 않는다. 그런 에이전트에게는 작업을 줄 때 `delta/AGENTS.md`를 먼저 읽으라고 지시한다.
- **S1:** v0.1.10 이후 main에서 원본이 같은 자리에 `<GlobalVoiceInputIndicator … />`를 추가했다.
  그 변경이 들어간 태그로 올릴 때 충돌이 나는데, 두 줄 모두 남기면 된다.
- **S4:** 단계 라벨은 contracts의 닫힌 목록(`Alpha | Beta | Dev | Nightly`)이라 건드리지 않는다.
  `displayName`만 바꾼다. 웹은 데스크톱이 주입한 이름을 그대로 쓴다.

## 임시 패치 (pending)

| ID | 원본 PR | 상태 | 내용 | 메모 |
|---|---|---|---|---|
| P1 | [#36733](https://github.com/pingdotgg/t3code/pull/36733) | 예정 | Antigravity 한도: Windows 자격 증명(`gemini:antigravity`) 읽기 | 이 PC(Windows)에 필요 |
| P2 | [#38957](https://github.com/pingdotgg/t3code/pull/38957) | 예정 | Antigravity 한도: 1.5.x CLI 로그인 파일과 키링 읽기 | 2026-11-20 원본에 머지됨. 다음 정식 릴리스에 들어가면 불필요 |
| P3 | [#34036](https://github.com/pingdotgg/t3code/pull/34036) | 선택 | Antigravity 사용량: 생성 1회만 집계 | |
| P4 | [#31703](https://github.com/pingdotgg/t3code/pull/31703) | 선택 | Antigravity 사용량: 캐시 토큰 이중 집계 수정 | |

P1과 P2는 같은 파일(`antigravityUsageLimits.ts`)을 고친다. P2가 들어간 원본 위에 P1을 얹는 순서가 안전하다.
원본 머지 여부는 `delta.mjs status`의 `원본 merged` 표시로 확인한다.

## 생성 파일

| 파일 | 충돌 시 |
|---|---|
| `apps/web/src/routeTree.gen.ts` | 원본 버전을 받고 라우트 생성기로 다시 생성 (delta 라우트를 추가한 경우) |
| `pnpm-lock.yaml` | 원본 버전을 받고 `vp i`로 다시 생성 |

## 리베이스 재적용 절차 (AI 에이전트용)

1. `delta.json`에서 상태가 `applied`인 항목만 대상으로 한다.
2. 각 seam의 기준점 설명으로 새 위치를 찾고, 같은 의도로 최소한만 고친다. 줄 번호에 기대지 않는다.
3. 기준점 자체가 사라졌으면(파일 이동·삭제), 가장 가까운 대체 위치를 찾고 `delta.json`과 이 표를 갱신한다.
4. `node delta/scripts/delta.mjs check`와 `vp run check:changed`가 통과해야 한다.
5. `delta.json`의 `upstream.tag`·`upstream.commit`을 새 기준으로 바꾸고 `revision`을 1로 되돌린다.
