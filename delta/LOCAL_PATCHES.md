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

| ID  | 상태 | 파일                                                   | 기준점                                                                  | 변경                                                                 | 용도                        |
| --- | ---- | ------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| S0  | 적용 | `CLAUDE.md`                                            | 파일 끝                                                                 | `@delta/AGENTS.md` 한 줄 추가                                        | Claude가 포크 규칙을 읽는다 |
| S1  | 예정 | `apps/web/src/routes/_chat.tsx`                        | `ChatRouteLayout`이 반환하는 fragment의 마지막 자식(닫는 `</>` 바로 앞) | `<DeltaSlot name="chat-layout" />`와 import                          | F1 전역 독                  |
| S2  | 예정 | `apps/web/src/components/sidebar/SidebarChrome.tsx`    | `SidebarChromeFooter`의 `<SidebarFooter>` 첫 자식                       | `<DeltaSlot name="sidebar-footer" />`와 import                       | F2a usage 위젯              |
| S3  | 선택 | `apps/web/src/components/sidebar/SidebarThreadRow.tsx` | `data-sidebar-row`가 붙은 카드 요소(card·slim 두 곳)                    | `data-status`, `data-provider` 속성                                  | F3b                         |
| S4  | 적용 | `apps/desktop/src/app/DesktopEnvironment.ts`           | `resolveDesktopAppBranding`이 반환하는 `displayName`                    | 버전이 `+delta.<N>`으로 끝나면 `T3 Code - Delta`, 아니면 원본 그대로 | 창 제목, 메뉴, About        |

메모

- **S0:** Codex 등 다른 에이전트는 `CLAUDE.md`가 아니라 루트 `AGENTS.md`를 읽는다. 루트 `AGENTS.md`는
  자주 바뀌어 seam을 두지 않는다. 그런 에이전트에게는 작업을 줄 때 `delta/AGENTS.md`를 먼저 읽으라고 지시한다.
- **S1:** v0.1.10 이후 main에서 원본이 같은 자리에 `<GlobalVoiceInputIndicator … />`를 추가했다.
  그 변경이 들어간 태그로 올릴 때 충돌이 나는데, 두 줄 모두 남기면 된다.
- **S4:** 단계 라벨은 contracts의 닫힌 목록(`Alpha | Beta | Dev | Nightly`)이라 건드리지 않는다.
  `displayName`만 바꾼다. 웹은 데스크톱이 주입한 이름을 그대로 쓴다.
  원본 테스트는 `+delta.`가 없는 버전을 쓰므로 그대로 통과한다. `APP_VERSION` 없이 빌드하면 원본 이름이 보여서
  잘못된 빌드를 바로 알 수 있다. 데이터 폴더(`t3code-v2`)와 Electron 앱 이름(`T3 Code Beta`)은 바뀌지 않는다.

## 임시 패치 (pending)

| ID  | 원본 PR                                                  | 상태 | 내용                                                                                             | 메모                                                                                       |
| --- | -------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| P2  | [#38957](https://github.com/pingdotgg/t3code/pull/38957) | 적용 | Antigravity 한도: 1.5.x CLI의 로그인 파일, OS 키링, Windows 자격 증명(`gemini:antigravity`) 읽기 | 원본 main에 2026-11-20 머지(`5283f33ca9`), 정식 릴리스 대기. 이 PC에서 자격 증명 읽기 확인 |
| P3  | [#34036](https://github.com/pingdotgg/t3code/pull/34036) | 선택 | Antigravity 사용량: 생성 1회만 집계                                                              |                                                                                            |
| P4  | [#31703](https://github.com/pingdotgg/t3code/pull/31703) | 선택 | Antigravity 사용량: 캐시 토큰 이중 집계 수정                                                     |                                                                                            |

임시 패치는 원본 main에 머지돼도 **정식 릴리스 태그에 들어갈 때까지** 유지한다. `delta.mjs status`가
`원본 merged, 정식 릴리스 대기` / `… v0.1.x에 포함 → 동기화 때 빠짐`으로 보여 주고, `delta.mjs sync`가 새 태그에
들어간 패치를 자동으로 뺀다.

### 지난 임시 패치

| ID  | 원본 PR                                                  | 뺀 날      | 이유                                                                         |
| --- | -------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| P1  | [#36733](https://github.com/pingdotgg/t3code/pull/36733) | 2026-11-20 | P2가 Windows 자격 증명 읽기(`CredReadW`)까지 포함해서 불필요. 적용한 적 없음 |

## 생성 파일

| 파일                            | 충돌 시                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `apps/web/src/routeTree.gen.ts` | 원본 버전을 받고 라우트 생성기로 다시 생성 (delta 라우트를 추가한 경우) |
| `pnpm-lock.yaml`                | 원본 버전을 받고 `vp i`로 다시 생성                                     |

## 리베이스 재적용 절차 (AI 에이전트용)

`node delta/scripts/delta.mjs sync`가 리베이스를 시작한다. 충돌로 멈추면 아래 절차로 고치고
`git rebase --continue`를 끝까지 한 다음 `node delta/scripts/delta.mjs sync --continue`를 실행한다.

1. `delta.json`에서 상태가 `applied`인 항목만 대상으로 한다.
2. 각 seam의 기준점 설명으로 새 위치를 찾고, 같은 의도로 최소한만 고친다. 줄 번호에 기대지 않는다.
3. 기준점 자체가 사라졌으면(파일 이동·삭제), 가장 가까운 대체 위치를 찾고 `delta.json`과 이 표를 갱신한다.
4. `node delta/scripts/delta.mjs check`와 `vp run check:changed`가 통과해야 한다.
5. `delta.json`의 `upstream`과 `revision`은 `sync --continue`가 바꾼다. 손으로 고치지 않는다.
