# T3 Code - Delta 스펙

> 상태: 초안 v0.2 (2026-11-20) · 기준 원본과 현재 상태는 `node delta/scripts/delta.mjs status`로 확인한다.

원본 T3 Code 위에 개인 기능 Δ(델타)를 얹는다. 원본은 거의 그대로 두고, Δ는 작게 유지한다.
저장소 구조, 원본 추적, 플러그인 구조는 [ARCHITECTURE.md](ARCHITECTURE.md)에 있다.

## 1. 이름

**T3 Code - Delta**

- 형식은 "T3 Code - 코드네임"이다. 원본 이름을 그대로 앞에 두어 무엇의 포크인지 바로 알 수 있게 한다.
- **Delta(Δ)** 는 차이를 뜻한다. 이 포크는 "원본 + Δ"이고, Δ를 작게 유지하는 것이 핵심 원칙이다.
- 식별자

| 대상 | 값 |
|---|---|
| GitHub 저장소 | `kimyc3825/t3code-delta` |
| 로컬 폴더 | `C:\Users\hana\t3code-delta` |
| 기본 브랜치 | `delta` (원본 미러는 `main`) |
| 포크 전용 폴더 | `delta/`, `apps/web/src/delta/` |
| 빌드 버전 | `<원본 버전>+delta.<리비전>`, 예: `0.1.10+delta.1` |
| 원본 수정 표시 | `[delta-seam:<ID>]` |
| 슬롯 컴포넌트 | `<DeltaSlot>` |

## 2. 목표와 비목표

목표

- **G1** 지금 어떤 원본 위에 있는지 저장소와 앱에서 언제든 알 수 있다.
- **G2** 원본의 정식 릴리스를 바로 따라가고, 만든 플러그인·기능이 같이 올라간다.
- **G3** 상주 어시스턴트, usage 상시 표시, Antigravity 한도 수정, 사이드바 꾸미기, 백테스트·리포트 MCP.
- **G4** 폰(T3 모바일 앱)에서도 기능을 쓸 수 있다.

비목표

- Rust 등 다른 언어로 포팅
- 원본 기능을 다시 만들거나 원본과 갈라지는 독자 개발
- 원본 수준의 범용 플러그인 시스템(설치 UI, 런타임 로딩) 구현. 이유는 ARCHITECTURE.md 4장
- 공개 배포나 스토어 출시 (개인용)

## 3. 설계 원칙

**P1. 3단 구조: 원본에서 먼 단계를 먼저 쓴다**

| 단계 | 원본 수정 | 원본 업데이트 때 | 예 |
|---|---|---|---|
| 0단: 원본의 공개 기능 | 없음 | 할 일 없음 | 테마 CSS, MCP 서버, 어시스턴트 스레드 |
| 1단: 임시 패치 | 원본의 열린 PR을 체리픽 | 원본이 머지하면 삭제 | Antigravity 한도 |
| 2단: 연결 지점(seam) | 파일당 1~2줄 | LOCAL_PATCHES.md를 보고 재적용 | 독, usage 위젯 슬롯 |

**P2. 기능은 MCP에, 화면은 그 위에.** 에이전트는 호스트(이 PC)에서 돌아간다. 그래서 MCP로 만든 기능은
데스크톱, 폰, 모든 Claude·Codex 스레드에서 똑같이 쓸 수 있다. 웹 UI는 데스크톱 전용 보조 화면이다.

**P3. 원본과의 접촉은 두 곳으로 좁힌다.** 원본 파일에는 슬롯(seam)만 두고, 원본 내부 코드는 `delta/sdk`를 통해서만 쓴다.

**P4. 업데이트는 정식 릴리스 태그 단위로 한다.** nightly와 main은 따라가지 않는다.
정식 릴리스는 3~6일마다 나오고, main에는 하루 약 290개 커밋이 들어온다.

## 4. 기능 명세

### F1. 상주 어시스턴트

| 항목 | 내용 |
|---|---|
| 두뇌 | "Assistant" 전용 T3 스레드. 고정(pin)하고 자동 정리는 Never로 둔다. 기본 프로바이더는 Claude |
| 도구 | T3 MCP 내장 도구 `t3_thread_list`, `t3_thread_read`, `t3_thread_search`, `t3_thread_send`, `schedule_task` |
| 주기 작업 | `schedule_task`의 continue 모드(맥락 유지) 또는 fresh_session(매번 새 맥락). 예: 평일 09:00에 지난 24시간 대화 요약, 새 원본 릴리스 알림 |
| 화면 (데스크톱) | 전역 독 플러그인. 슬롯 `chat-layout`(S1). 스레드를 옮겨도 유지되고, 오른쪽에서 열고 닫는다. 단축키는 원본 `registerCommands`로 등록한다(원본 수정 없음) |
| 독 내용 | 어시스턴트 스레드 대화, 위젯(오늘 요약, usage) |
| 화면 (폰) | 어시스턴트 스레드 그 자체 |

수용 기준

- 스레드를 바꿔도 독이 닫히지 않는다.
- 폰에서 어시스턴트 스레드에 보낸 요청이 같은 맥락으로 처리된다.
- 원본 수정은 S1뿐이다.

오른쪽 패널을 쓰지 않는 이유: 오른쪽 패널은 상태가 스레드마다 따로 저장된다
(`apps/web/src/rightPanelStore.ts`의 `byThreadKey`). 그래서 스레드를 바꾸면 사라진다.
또 패널 종류를 하나 추가하려면 원본 파일 6개를 고쳐야 한다.

검토할 것: 독의 대화 화면에 원본 `SideChatPane`(다른 스레드를 작은 채팅으로 보여주는 컴포넌트)을
재사용할 수 있는지.

### F2. Usage 상시 표시와 Antigravity 한도

**F2a. 사이드바 하단 usage 위젯**

- 위치: 슬롯 `sidebar-footer`(S2), 즉 `SidebarChromeFooter` 안
- 내용
  - 프로바이더별 한도 막대: 원본 `LimitWindows`, `UsageLimitsSection` 재사용(sdk 경유)
  - 오늘·이번 주 비용과 토큰: 원본 `useUsage`(sdk 경유)
- 데이터: 한도는 서버 설정 스트림으로 이미 앱에 들어와 있어서 추가 요청이 없다.
- 접기·펼치기, 프로바이더 숨기기를 지원한다.

**F2b. `usage_summary` MCP 도구**

- 폰이나 어시스턴트가 "이번 주 사용량"을 물을 수 있게 한다.
- 구현: T3 RPC `server.getUsageSummary`를 부른다. 권한은 `diagnostics:read`, 토큰은 `t3 auth session issue`로 받는다.
- 위치: `delta/plugins/usage/mcp/`

**F2c. Antigravity 한도 수정 (1단)**

- 원인 (이 PC에서 확인함)
  - 한도 코드는 `<profile>/antigravity-acp/acp_token.json`만 읽는다
    (`apps/server/src/provider/antigravityUsageLimits.ts`).
  - agy 1.5.x는 이 파일을 만들지 않고, 로그인 정보를 Windows 자격 증명 관리자의 `gemini:antigravity`에 저장한다.
  - 그래서 "Sign in with Google to see Antigravity limits"에서 멈춘다.
- 조치: P1 [#36733](https://github.com/pingdotgg/t3code/pull/36733)(Windows 자격 증명).
  P2 [#38957](https://github.com/pingdotgg/t3code/pull/38957)(파일·키링)은 원본에 머지됐으니 다음 정식 릴리스로 올리면 함께 들어온다.
- 선택: P3 [#34036](https://github.com/pingdotgg/t3code/pull/34036), P4 [#31703](https://github.com/pingdotgg/t3code/pull/31703)(토큰 집계)
- 수용 기준: F2a 위젯과 `/usage` 페이지에 Antigravity 한도가 표시된다.

### F3. 사이드바 카드 꾸미기

**F3a. 테마 CSS (0단)**

- 테마 파일은 `delta/plugins/sidebar-style/theme/<id>.json`에 둔다. 설치 스크립트가
  `~/.t3/userdata/themes/`로 복사하고, 저장 즉시 반영된다.
- 형식: `name`, `appearance`, `canvas`+`accent`(또는 `colors`), `css`(최대 100,000자)
- 안정 선택자
  - 원본이 테스트로 보장: `[data-thread-item]`, `[data-slot="sidebar"]`, `[data-slot="sidebar-inner"]`
  - 카드 내부: `[data-testid="sidebar-row-card"]`, `[aria-current="page"]`(활성), `[aria-busy]`(제목 생성 중)
- 제약: 선택한 테마의 CSS만 적용, `url()`은 `data:`만, 모바일 미적용, 상태별·프로바이더별 선택자 없음

**F3b. 상태·프로바이더 속성 (선택, 2단이며 원본 PR 후보)**

- S3: 카드에 `data-status`(working, failed, approval 등)와 `data-provider`를 추가한다.
- 원본의 테마 선택자 정책과 맞는 변경이라 원본에 PR로 올릴 만하다. 머지되면 0단이 된다.

### F4. 백테스팅·리포팅 MCP

| 항목 | 내용 |
|---|---|
| 형태 | Claude Code 플러그인(MCP 서버, 사용법 스킬, `.mcp.json`). 사용자 범위로 설치한다. Codex는 설정에 따로 등록한다 |
| 위치 | `delta/plugins/backtest/`. 전략과 데이터는 `delta/private/` 또는 별도 비공개 저장소 |
| 도구 | `backtest_run(strategy, symbols, period, params)` → job_id를 바로 돌려준다 · `backtest_status(job_id)` · `backtest_result(job_id)`(CAGR, MDD, Sharpe, 승률, 거래 수) · `backtest_compare(job_ids)` · `report_build(job_id)` |
| 실행 방식 | 비동기 작업. 오래 걸리는 계산이 도구 호출 시간 제한에 걸리지 않게 한다 |
| 리포트 | MCP Apps(`ui://`)로 수익 곡선, 낙폭, 월별 히트맵, 거래 표를 스레드 안에 보여준다(웹·데스크톱·모바일). HTML 파일로도 저장한다 |
| 권한 | 계산·조회 도구는 read-only로 표시한다. 그래야 MCP App 버튼을 누를 때마다 승인을 묻지 않는다 |
| 정기 리포트 | `schedule_task`로 주 1회 다시 실행하고 리포트를 만든다. 폰으로 알림이 온다 |
| 안전 | 계산·조회 전용. 실제 주문 기능은 별도 서버로 분리하고 호출마다 승인을 받는다 |

요구 환경: MCP Apps는 Claude Code 2.1.301 이상이 필요하다(현재 2.1.328). Codex도 지원한다.
그 외 프로바이더에서는 일반 도구 호출로 보인다.

## 5. 빌드와 실행

- 개발: [docs/operations/development.md](../docs/operations/development.md)를 따른다(Vite+ `vp i`, `vp run dev`).
  개발 서버는 `T3CODE_HOME`을 별도 폴더로 지정해서 실제 `~/.t3` 데이터를 보호한다.
- 버전: 빌드할 때 `APP_VERSION=$(node delta/scripts/delta.mjs version)`을 넘긴다. 웹, 서버, 데스크톱 패키저가 모두
  이 값을 쓴다. 넘기지 않으면 원본 규칙상 `package.json`의 이전 버전(v0.1.10 기준 `0.1.9`)이 표시된다.
- 데스크톱 빌드: 웹 UI와 서버가 앱 안에 묶여 있어서, 1·2단 기능은 앱을 직접 빌드해야 적용된다.
- 공식 자동 업데이트가 포크 빌드를 덮어쓰므로 `T3CODE_DISABLE_AUTO_UPDATE=1`을 반드시 설정한다.
- 0단 기능(테마, MCP, 어시스턴트 스레드)은 공식 앱에서도 동작한다.

## 6. 보안과 공개 범위

- **이 저장소는 공개다.** 공개 저장소의 포크는 비공개로 바꿀 수 없다.
  토큰, 전략, 거래 데이터, 대화 내용은 커밋하지 않는다. `delta/private/`(git 제외)나 별도 비공개 저장소에 둔다.
- **배포 키:** 이 저장소에만 쓰기 권한이 있는 키다. 이 PC의 `~/.ssh/t3code-delta_deploy`에 있다.
  해지하려면 GitHub 저장소 Settings → Deploy keys에서 지운다.
- **GitHub Actions:** 꺼 두었다. 원본의 CI·릴리스 워크플로가 시크릿 없이 돌지 않게 하기 위해서다.
  동기화 자동화용 워크플로를 따로 만들 때만 켠다.
- **원본 저장소:** 사용자 승인 없이 push, PR, 이슈, 코멘트를 하지 않는다. upstream의 push 주소는 비활성이고,
  T3와 gh CLI의 기본 저장소는 포크로 지정했다(`remote.origin.gh-resolved=base`).

## 7. 마일스톤

| | 범위 | 상태 |
|---|---|---|
| M0 | 포크, 클론, 문서, T3 프로젝트 등록, 원본 추적 도구(`delta.json`, `delta.mjs`) | 완료 |
| M1 | 원본 최신 정식 릴리스로 동기화, F3a 테마, P1 패치, 동기화 스크립트, 새 원본 알림, 첫 데스크톱 빌드(버전·S4 검증) | |
| M2 | 플러그인 호스트(`DeltaSlot`, sdk, 오류 경계), S1·S2, F2a usage 위젯 | |
| M3 | F1 어시스턴트 스레드와 독 | |
| M4 | F2b usage MCP, F4 백테스트·리포트 MCP | |

## 8. 미정 사항

1. F4: 대상 시장, 데이터 소스, 전략 언어
2. 앱 식별자: 공식 앱과 같은 ID로 대체 설치(권장, `~/.t3` 데이터 공유)할지, 분리해 동시 설치할지
3. 독 형태: 위에 덮는 오버레이, 또는 채팅 영역을 밀어내는 고정 칼럼(이 경우 seam이 늘어난다)
4. 어시스턴트의 모델과 실행 주기
5. F3b를 원본에 PR로 올릴지
