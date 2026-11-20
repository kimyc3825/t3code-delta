# LOCAL_PATCHES: 원본 수정 목록

원본(pingdotgg/t3code) 파일을 건드리는 변경은 모두 등록한다. 원본 업데이트로 리베이스할 때
이 문서가 기준이다. **등록되지 않은 원본 수정은 버그로 본다.**

- 기능 확장을 위한 **연결 지점(seam)** 은 이 문서에 둔다.
- 원본 버그를 고치는 **수정(직접 수정 H, 임시 패치 P)** 은 원본이 언젠가 고칠 수 있으므로
  [PATCHNOTES.md](PATCHNOTES.md)에 따로 두고 원본을 올릴 때마다 검토한다.

- 기계가 읽는 목록은 [delta.json](delta.json)이다. 이 문서는 사람과 AI 에이전트를 위한 설명이다.
  둘이 다르면 `delta.json`을 기준으로 이 문서를 고친다.
- 현재 상태 확인: `node delta/scripts/delta.mjs status`
- 규칙 검사: `node delta/scripts/delta.mjs check` (등록 안 된 seam·수정 표시, 누락된 표시, 커밋 규칙 위반을 잡는다)

## 규칙

- 연결 지점(seam)은 파일당 import 1줄과 사용 1줄을 목표로 한다. 로직은 `apps/web/src/delta/`에 둔다.
- 원본 파일에서 고친 줄에는 `[delta-seam:<ID>]`(직접 수정은 `[delta-fix:<ID>]`) 주석을 단다. 주석을 달 수 없는 파일(예: `CLAUDE.md`)은
  `delta.json`의 `contains`로 확인한다.
- 기준점은 줄 번호가 아니라 의미(함수, JSX 요소)로 적는다. 원본이 줄을 옮겨도 다시 찾을 수 있게 하기 위해서다.
- 커밋은 seam 하나당 하나, 메시지는 `seam(<ID>): …`로 쓴다. 수정은 `hotfix(<ID>): …`, `pending(#<PR>): …`다.
- 스택 순서는 기준 태그부터 pending → hotfix → seam → delta다.

## 연결 지점 (seam)

| ID  | 상태 | 파일                                                   | 기준점                                                                   | 변경                                                                         | 용도                           |
| --- | ---- | ------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------ |
| S0  | 적용 | `CLAUDE.md`                                            | 파일 끝                                                                  | `@delta/AGENTS.md` 한 줄 추가                                                | Claude가 포크 규칙을 읽는다    |
| S1  | 예정 | `apps/web/src/routes/_chat.tsx`                        | `ChatRouteLayout`이 반환하는 fragment의 마지막 자식(닫는 `</>` 바로 앞)  | `<DeltaSlot name="chat-layout" />`와 import                                  | F1 전역 독                     |
| S2  | 예정 | `apps/web/src/components/sidebar/SidebarChrome.tsx`    | `SidebarChromeFooter`의 `<SidebarFooter>` 첫 자식                        | `<DeltaSlot name="sidebar-footer" />`와 import                               | F2a usage 위젯                 |
| S3  | 선택 | `apps/web/src/components/sidebar/SidebarThreadRow.tsx` | `data-sidebar-row`가 붙은 카드 요소(card·slim 두 곳)                     | `data-status`, `data-provider` 속성                                          | F3b                            |
| S4  | 적용 | `apps/desktop/src/app/DesktopEnvironment.ts`           | `resolveDesktopAppBranding`이 반환하는 `displayName`                     | 버전이 `+delta.<N>`으로 끝나면 `T3 Code - Delta`, 아니면 원본 그대로         | 창 제목, 메뉴, About           |
| S5  | 적용 | `scripts/build-desktop-artifact.ts`                    | `resolveDesktopProductName` 첫 줄, `createBuildConfig`의 `appId`, import | Delta 버전이면 앱 ID `dev.t3code-delta.desktop`, 제품 이름 `T3 Code - Delta` | 공식 앱과 따로 설치            |
| S6  | 적용 | `apps/desktop/src/app/DesktopUserData.ts`              | `resolveUserDataPath`의 `names`                                          | Delta 버전이면 Electron 프로필 폴더 `t3code-delta`                           | 창 상태·로그인 분리, 동시 실행 |
| S7  | 적용 | `apps/desktop/src/app/DesktopEnvironment.ts`           | `resolveDesktopBaseDir`에 넘기는 `t3Home`                                | Delta 버전이고 `T3CODE_HOME`이 없으면 `~/.t3-delta`                          | 대화 데이터 폴더 분리          |
| S8  | 적용 | `apps/desktop/src/app/DesktopEnvironment.ts`           | `appUserModelId` 기본값                                                  | Delta 버전이면 `dev.t3code-delta.desktop`                                    | 작업 표시줄·알림 분리          |

메모

- **S0:** Codex 등 다른 에이전트는 `CLAUDE.md`가 아니라 루트 `AGENTS.md`를 읽는다. 루트 `AGENTS.md`는
  자주 바뀌어 seam을 두지 않는다. 그런 에이전트에게는 작업을 줄 때 `delta/AGENTS.md`를 먼저 읽으라고 지시한다.
- **S1:** v0.1.10 이후 main에서 원본이 같은 자리에 `<GlobalVoiceInputIndicator … />`를 추가했다.
  그 변경이 들어간 태그로 올릴 때 충돌이 나는데, 두 줄 모두 남기면 된다.
- **S5~S8 (따로 설치):** 모두 버전이 `+delta.<N>`으로 끝날 때만 동작하고, 값은 `apps/desktop/src/delta/identity.ts`에 모았다.
  원본 테스트와 버전 없는 빌드는 원본 그대로다. 대화는 공식 앱 서버를 Delta의 "Add environment"로 연결해서 본다
  (한 T3 홈은 서버 하나만 쓸 수 있다). Delta가 설치하는 `t3` CLI는 `~/.t3-delta/bin`에 들어가지만 PATH에서 공식 앱 것이 앞선다.
- **S4:** 단계 라벨은 contracts의 닫힌 목록(`Alpha | Beta | Dev | Nightly`)이라 건드리지 않는다.
  `displayName`만 바꾼다. 웹은 데스크톱이 주입한 이름을 그대로 쓴다.
  원본 테스트는 `+delta.`가 없는 버전을 쓰므로 그대로 통과한다. `APP_VERSION` 없이 빌드하면 원본 이름이 보여서
  잘못된 빌드를 바로 알 수 있다. 데이터 폴더(`t3code-v2`)와 Electron 앱 이름(`T3 Code Beta`)은 바뀌지 않는다.

## 수정 (hotfix, pending)

[PATCHNOTES.md](PATCHNOTES.md)를 본다. 직접 수정 H1(단일 틸드), 임시 패치 P2(Antigravity 한도)가 적용돼 있다.

## 생성 파일

| 파일                            | 충돌 시                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `apps/web/src/routeTree.gen.ts` | 원본 버전을 받고 라우트 생성기로 다시 생성 (delta 라우트를 추가한 경우) |
| `pnpm-lock.yaml`                | 원본 버전을 받고 `vp i`로 다시 생성                                     |

## 리베이스 재적용 절차 (AI 에이전트용)

`node delta/scripts/delta.mjs review` 뒤에 `node delta/scripts/delta.mjs sync`가 리베이스를 시작한다.
충돌로 멈추면 아래 절차로 고치고 `git rebase --continue`를 끝까지 한 다음, 충돌 안내에 나온
`node <git 폴더>/delta-sync-tool/delta.mjs sync --continue`를 실행한다.
Δ 커밋은 스택 맨 위라 충돌 중에는 `delta/`가 작업 폴더에 없을 수 있다. 그래서 이 문서와 PATCHNOTES.md는
백업 브랜치에서 읽는다: `git show backup/delta-<이전 태그>-r<리비전>:delta/LOCAL_PATCHES.md`

1. `delta.json`에서 상태가 `applied`인 항목만 대상으로 한다. 직접 수정의 충돌은 PATCHNOTES.md의 "알려진 충돌"을 먼저 본다.
2. 각 seam의 기준점 설명으로 새 위치를 찾고, 같은 의도로 최소한만 고친다. 줄 번호에 기대지 않는다.
3. 기준점 자체가 사라졌으면(파일 이동·삭제), 가장 가까운 대체 위치를 찾고 `delta.json`과 이 표를 갱신한다.
4. `node delta/scripts/delta.mjs check`와 `vp run check:changed`가 통과해야 한다.
5. `delta.json`의 `upstream`과 `revision`은 `sync --continue`가 바꾼다. 손으로 고치지 않는다.
