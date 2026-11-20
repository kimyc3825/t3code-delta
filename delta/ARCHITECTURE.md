# 구조 설계: 원본 추적과 플러그인

> 2026-11-20 · 원본 v0.1.10(`7d32075e37`) 코드베이스와 PR #33606을 검토해서 정했다.

## 0. 요구사항

- **R1. 지금 어떤 원본 위에 있는지 언제든 알 수 있다.** 저장소에서, 빌드된 앱에서, 그리고 원본에 새 정식 릴리스가 나왔는지까지.
- **R2. 원본을 올릴 때 만든 플러그인·기능이 같이 올라간다.** 원본이 바뀌어도 고칠 곳이 적고, 어디를 고칠지 정해져 있어야 한다.

## 1. 원본 코드베이스 검토 결과

| 항목          | 원본 동작 (v0.1.10)                                                                                                                                                                                    | 우리에게 의미                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 버전 결정     | `scripts/lib/tagged-source-version.ts`: HEAD가 **정확히** `vX.Y.Z` 태그이고 `package.json`이 수정되지 않았을 때만 태그 버전을 쓴다. 아니면 `package.json` 버전을 쓴다                                  | 태그 v0.1.10의 `package.json`은 `0.1.9`다(버전 올림 커밋은 릴리스 후 main에 들어간다). 포크(태그 + 커밋)를 그대로 빌드하면 **0.1.9로 표시된다** |
| 버전 주입     | `APP_VERSION` 환경변수가 최우선이다. 웹(`apps/web/vite.config.ts`), 서버(`apps/server/vite.config.ts`), 데스크톱 패키저(`scripts/build-desktop-artifact.ts`, `T3CODE_DESKTOP_VERSION`) 모두 같다       | 원본 수정 없이 "원본 버전 + 포크 리비전"을 넣을 수 있다                                                                                         |
| 버전 표시     | Settings → About이 `APP_VERSION`을 그대로 보여준다(`AboutVersionTitle.tsx`)                                                                                                                            | 주입한 버전이 그대로 보인다                                                                                                                     |
| 앱 이름       | 데스크톱이 `T3 Code (Beta \| Nightly \| Dev)`로 정해 웹에 주입한다(`DesktopEnvironment.ts`의 `resolveDesktopAppBranding`). 단계 라벨은 contracts의 닫힌 목록이다                                       | "T3 Code - Delta"로 보이게 하려면 seam이 하나(S4) 필요하다                                                                                      |
| 앱 ID         | 패키저 상수 `com.t3tools.t3code`                                                                                                                                                                       | 공식 앱과 같다. 대체 설치할지 분리할지는 SPEC 미정 사항                                                                                         |
| 업데이트 확인 | `T3CODE_DISABLE_AUTO_UPDATE`를 켜면 확인 자체를 하지 않는다                                                                                                                                            | 앱 안에서는 새 원본 알림을 받을 수 없다. 우리 도구로 대신한다                                                                                   |
| 확장 지점     | 범용 플러그인 시스템이 없다. 공개된 것은 테마 CSS(테스트로 보장하는 안정 선택자), 외부 MCP 서버(MCP Apps 포함), T3 MCP 도구, 예약 작업이다. 오른쪽 패널 종류, 설정 섹션, 커맨드 팔레트는 닫힌 목록이다 | 웹 UI를 붙이려면 원본 파일에 접점이 필요하다. 그 외는 원본 수정 없이 된다                                                                       |

## 2. R1 설계: 원본 식별

**단일 기준은 [delta.json](delta.json)이다.** `upstream.tag`, `upstream.commit`, `codename`, `revision`과
seam·pending 목록을 담는다. 동기화할 때만 바꾼다. 플러그인 목록은 각 플러그인 폴더의 `plugin.json`이 기준이다.

**버전 형식은 `<원본 버전>+delta.<리비전>`이다.** 예: `0.1.10+delta.1`

- semver의 빌드 메타데이터라 버전 비교에서는 `0.1.10`과 같게 취급된다(M1에서 확인). 원본 `parseSemver`와
  `compareSemverVersions`(`packages/shared/src/semver.ts`)는 `+` 뒤를 무시하고, 클라이언트·서버 버전 불일치 검사
  (`apps/web/src/versionSkew.ts`의 `versionCore`)도 `+` 뒤를 버린다. 그래서 폰이나 다른 클라이언트와의 호환 판단은
  원본 `0.1.10`과 같다.
- 리비전은 같은 원본 위에서 포크를 빌드할 때마다 1씩 올리고, 원본을 올리면 1로 되돌린다.
- 포크 빌드마다 같은 이름의 태그를 단다: `v0.1.10+delta.1`

**확인 방법**

| 어디서          | 어떻게                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 저장소          | `node delta/scripts/delta.mjs status`: 기준 원본, 최신 원본(새 정식 릴리스 수), 기준 위 커밋 구성, seam 적용 여부, pending PR의 원본 머지 여부                                                                                             |
| 자동화·에이전트 | `delta.mjs status --json`, `delta.mjs check`(위반 시 종료 코드 1)                                                                                                                                                                          |
| 빌드된 앱       | `APP_VERSION=$(node delta/scripts/delta.mjs version)`으로 빌드하면 About에 `0.1.10+delta.1`. 창 제목은 S4로 `T3 Code - Delta`. S4는 버전이 `+delta.<N>`으로 끝날 때만 이름을 바꾸므로, `APP_VERSION` 없이 잘못 빌드하면 원본 이름이 보인다 |
| 새 원본 알림    | T3 예약 작업 "Delta 새 원본 알림"이 매일 09:00에 `delta.mjs status`를 돌리고, 새 정식 릴리스가 있으면 `sync --dry-run` 계획과 함께 알린다                                                                                                  |

## 3. R2 설계: 플러그인이 원본 업데이트를 따라가는 구조

원칙은 두 가지다. **플러그인 코드는 원본과 겹치지 않는 경로에 둔다.**
**원본과의 접촉은 슬롯(seam)과 sdk 두 곳으로 좁힌다.**

```
delta/
├─ delta.json                      기준 원본, seam(슬롯 포함), pending
├─ scripts/delta.mjs               status · version · check
└─ plugins/<id>/                   플러그인 하나 = 폴더 하나
   ├─ plugin.json                  매니페스트 (아래)
   ├─ mcp/                         MCP 서버. 별도 프로세스로 Claude·Codex에 등록
   └─ theme/                       테마 JSON. ~/.t3/userdata/themes로 설치
apps/web/src/delta/
├─ host/                           DeltaSlot, 레지스트리, 플러그인별 오류 경계
├─ sdk/                            원본 내부 API 파사드. 플러그인은 원본을 여기서만 import
└─ plugins/<id>/                   플러그인의 웹 부분
```

**플러그인 매니페스트 (`plugin.json`)**

```json
{
  "id": "usage-widget",
  "name": "Usage 위젯",
  "version": "0.1.0",
  "description": "사이드바 하단에 프로바이더별 한도와 오늘 비용을 항상 보여준다",
  "enabled": true,
  "testedUpstream": "v0.1.10",
  "parts": { "web": "apps/web/src/delta/plugins/usage-widget" },
  "slots": ["sidebar-footer"]
}
```

| 필드             | 뜻                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | 폴더 이름과 같아야 한다. MCP 서버 이름은 `delta-<id>`, 커맨드는 `delta.<id>.<cmd>`                                                                                                                                                         |
| `enabled`        | `false`면 빌드에서 뺀다                                                                                                                                                                                                                    |
| `testedUpstream` | 이 플러그인을 마지막으로 확인한 원본 태그. **R2의 검증 게이트**: 원본을 올리면 `delta.json`의 태그와 달라져서, 확인하고 이 값을 올리기 전까지 `delta.mjs check`가 실패한다. 원본 업데이트 뒤 어떤 플러그인을 봐야 하는지가 목록으로 나온다 |
| `parts`          | `web`(웹 부분 경로), `mcp`, `theme`. 선언한 경로가 없으면 `check`가 실패한다                                                                                                                                                               |
| `slots`          | 쓰는 슬롯. 슬롯의 seam이 적용되지 않았으면 `check`가 실패한다                                                                                                                                                                              |

웹 부분만 `apps/web/src/delta/` 아래에 두는 이유는 실행 환경이 다르기 때문이다. 웹 코드는 원본 웹 앱의 타입 검사와
린트를 그대로 받아야 원본 변경으로 깨진 곳이 바로 드러난다. MCP 서버는 Node 프로세스라 웹 tsconfig에 넣지 않는다.

**플러그인 부분별 원본 접촉**

| 부분              | 실행 위치              | 원본 접촉                                                      | 예                                |
| ----------------- | ---------------------- | -------------------------------------------------------------- | --------------------------------- |
| theme             | T3 테마 로더           | 없음 (공개 기능)                                               | F3a 사이드바 꾸미기               |
| mcp               | 별도 프로세스          | 없음 (공개 기능)                                               | F2b usage MCP, F4 백테스트        |
| web               | 앱 번들 (빌드 때 포함) | 슬롯 + sdk                                                     | F1 독, F2a usage 위젯             |
| T3 서버 내부 확장 | 쓰지 않음              | —                                                              | MCP로 대신한다                    |
| 원본 버그 수정    | 서버·웹                | 직접 수정(H) 또는 임시 패치(P). [PATCHNOTES.md](PATCHNOTES.md) | H1 단일 틸드, P2 Antigravity 한도 |

**원본이 바뀔 때 무엇이 깨지고 어디서 고치나**

| 원본 변화                                    | 증상                  | 고치는 곳                                                                                                 |
| -------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| seam이 있는 원본 파일의 텍스트 변경          | 리베이스 충돌         | LOCAL_PATCHES.md의 기준점대로 재적용. 각 1~2줄                                                            |
| 원본 내부 API 변경 (컴포넌트·훅 이름, props) | 타입 오류             | `apps/web/src/delta/sdk` 한 곳. 플러그인은 그대로                                                         |
| 테마 선택자 변경                             | 스타일 일부가 안 먹음 | 원본이 테스트로 유지를 보장하는 선택자만 쓰므로 드물다                                                    |
| MCP·RPC 계약 변경                            | 거의 없음             | 원본이 이전 클라이언트 호환을 유지한다                                                                    |
| 의존성 (`pnpm-lock.yaml`)                    | 충돌                  | 원본 lockfile을 받고 재생성. 웹 플러그인은 원본 의존성만 쓰고, 새 의존성은 MCP 쪽(워크스페이스 밖)에 둔다 |
| 원본이 같은 기능을 출시                      | 중복                  | 해당 플러그인을 끄거나 지우고 `delta.json`에서 뺀다                                                       |

**호스트 동작** (`apps/web/src/delta/host`, 2026-11-20 사이드바 부분 구현)

- **빌드 때 포함:** `registry.ts`가 Vite `import.meta.glob`로 `apps/web/src/delta/plugins/*/index.ts`와
  `delta/plugins/*/plugin.json`을 모은다. `plugin.json`의 `enabled`가 `false`이거나 매니페스트가 없으면 넣지 않는다.
  런타임 로더, 업로드, 파일 서빙이 없어서 데스크톱 CSP 문제도 없다.
- **끄기:** `VITE_DELTA_PLUGINS=off`로 빌드하면 플러그인을 하나도 넣지 않는다. 버그가 원본 것인지 Δ 것인지 가를 때 쓴다.
- **등록:** 플러그인은 `defineDeltaPlugin({ id, sidebar: { … } })`를 default export한다(`host/types.ts`).
- **사이드바 확장 (S9~S12):** `arrangeProjectFolder`(프로젝트 폴더의 스레드 정렬·필터, 선택 순서도 따라감),
  `renderProjectFolder`(그 행 그리기), `threadMenuItems`·`onThreadMenu`(스레드·선택 메뉴 항목, id는 `delta.<플러그인>.<명령>`).
  플러그인 상태가 바뀌면 `host/changes.ts`의 `notifySidebarChanged()`로 사이드바를 다시 그리게 한다.
- **격리:** 훅 호출은 `guardPlugin`이 감싸서, 플러그인이 예외를 던지면 기록하고 원본 동작으로 돌아간다.
  플러그인이 그린 요소는 `DeltaBoundary`가 감싸서 렌더링 오류가 나도 사이드바는 남는다.
- **남은 것 (M2):** 범용 슬롯 `<DeltaSlot name="…">`(S1 독, S2 usage 위젯), `delta.mjs check`의 sdk 우회 import 검사.

**업데이트 절차: 검토하고 올린다** (`delta.mjs review` → `delta.mjs sync`)

```sh
node delta/scripts/delta.mjs review            # 최신 정식 릴리스를 검토한다. --nightly는 다음 릴리스 미리 보기
#  → delta/reviews/<기준>..<새 태그>.md를 읽고, 직접 수정(H)마다 유지할지 정한다
node delta/scripts/delta.mjs sync --dry-run    # 계획만 본다
node delta/scripts/delta.mjs sync              # 검토한 태그로 올린다
```

`review`가 만드는 보고서

1. 원본에서 바뀐 것: 범위 안 정식 릴리스마다 원본 릴리스 노트의 요약, 원본 커밋 수와 바뀐 파일 수
2. Delta에 미치는 영향
   - 직접 수정(H): 원본 이슈·PR 상태, 같은 문제를 다룬 원본 커밋(키워드), 관련 파일을 바꾼 원본 커밋, 판단
   - 임시 패치(P): 원본 PR이 새 태그에 들어 있는지 → 자동으로 빠지는지
   - seam: 원본 파일을 바꾼 커밋 수, 파일이 없어졌는지 → 충돌 가능성
   - 플러그인: `plugin.json`의 `watch`에 적은 원본 파일을 바꾼 커밋
   - 빌드 도구: Node, pnpm, Electron 버전 변화
3. 결정할 것: 체크리스트

`sync`가 하는 일

1. 그 태그의 검토 보고서가 없으면 멈춘다. **검토 없이는 올리지 않는다.**
2. 새 태그를 upstream에서 가져온다(이미 로컬에 있으면 그대로 쓴다).
3. 뺄 커밋을 정한다. 임시 패치는 원본 PR의 머지 커밋이 **새 태그에 들어 있을 때만** 뺀다(main 머지만으로는 남긴다).
   직접 수정은 `delta.json`에서 `retired`로 표시한 것만 뺀다.
4. 백업 브랜치 `backup/<브랜치>-<이전 태그>-r<리비전>`을 만들고, 도구를 git 폴더(`delta-sync-tool`)에 복사한다.
   Δ 커밋은 스택 맨 위라 충돌로 멈춘 동안에는 `delta/`가 작업 폴더에 없을 수 있기 때문이다.
5. `git rebase --onto <새 태그> <이전 기준 커밋>`으로 스택을 다시 쌓는다. rerere가 기억한 충돌 해결은 자동으로 다시 적용된다.
6. 충돌로 멈추면 안내대로 고치고 `git rebase --continue`, 끝나면 `node <git 폴더>/delta-sync-tool/delta.mjs sync --continue`.
   그만두려면 같은 경로로 `--abort`. 규칙 문서는 백업 브랜치에서 읽는다.
7. `delta.json`의 `upstream`과 `revision`(1로)을 바꾸고, 뺀 수정을 목록에서 지운 뒤 보고서와 함께
   `delta: sync to upstream <태그>`로 커밋한다.

사람(또는 에이전트)이 할 일

- 뺀 수정을 PATCHNOTES.md의 "지난 수정"으로 옮기고, 보고서를 "검토 기록"에 링크한다.
- `vp i`, `vp run check:changed`. 플러그인은 모두 "재검증 필요"로 뜬다. 플러그인마다 동작을 확인하고
  `testedUpstream`을 새 태그로 올린다. 테마 플러그인은 `build.mjs`로 다시 만든다(원본 기본 색을 따라가기 위해).
- `git push --force-with-lease origin delta`, `gh repo sync kimyc3825/t3code-delta -b main`
- 충돌을 스스로 못 풀면 T3 스레드의 AI 에이전트에게 LOCAL_PATCHES.md·PATCHNOTES.md 기준 재적용을 맡긴다.

2026-11-20에 가짜 태그(원본 nightly 커밋, 원본 커밋 634개 앞)로 전체 흐름을 시험했다. 검토 없는 sync 거부,
P2 자동 제외, retired H1 제외, H1 유지 시 테스트 파일 충돌과 복사된 도구로 `--continue`·`--abort`까지 확인했다.

## 4. PR #33606 검토

[#33606](https://github.com/pingdotgg/t3code/pull/33606) "plugins add panels, commands, styles and agent tools without a fork"
(2026-11-09 열림, 11-12 머지 없이 닫힘)을 참고할지 검토했다.

### 무엇이었나

- **플러그인:** `t3-plugin.json`이 든 폴더. 필드는 `id`, `name`, `version`, `engines.t3`(호환 T3 범위),
  `server`, `web`, `settingsSchema`, `permissions`. 그 밖에 `themes/`, `styles/`, `assets/` 폴더를 둔다.
- **서버 절반:** T3 서버 프로세스 안에서 돈다. RPC·채널·저장소·설정 폼·MCP 도구를 제공한다.
  실패는 `AsyncLocalStorage`로 플러그인에 귀속시켜 격리하고, `--no-plugins`로 모두 끌 수 있다.
- **웹 절반:** 런타임에 `blob:` URL로 import한다. `globalThis.__t3PluginHost`로 React, UI 키트, atom을 공유한다.
  제공하는 확장 지점은 오른쪽 패널(스레드별), 커맨드, 설정 패널, `ui.replace`(컴포저 컨트롤, 페이지 프레임, 사이드바 전체)다.
- **그 외:** 설치·업로드 UI, 환경 선택, `plugins.json`·`plugins.sqlite` 저장소

### 숫자

| 항목                       | 값                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 규모                       | 파일 202개, +16,114 / −304                                                                                             |
| **원본 파일 수정**         | **94개** (+2,223 / −304). 웹 47, 서버 17, 데스크톱 11, contracts 9, 기타 10                                            |
| 새 파일                    | 108개 (+13,891)                                                                                                        |
| 수정 파일의 원본 변경 빈도 | 94개 중 88개가 PR 기준 시점 이후 9일 안에 원본에서 바뀌었다. 예: `ChatComposer.tsx` 33커밋, `server.ts` 29, `ws.ts` 28 |
| 결과                       | 그 사이 main을 3번 병합했다(충돌 해결, lockfile 재생성). 결국 4개 파일 충돌로 닫혔다                                   |
| 플러그인과 무관한 변경     | 테마 스키마 확장, 데스크톱 창 배경, 컴포저 스크롤 접기가 섞여 있다                                                     |

### 원본 메인테이너 입장

- 원본 CONTRIBUTING.md는 "Architecture overhauls (extensions, plugins, …)"를 자동으로 닫는 대상에 넣는다.
- Theo(2026-08): "We do not want to establish that large trusted-plugin contract through one branch."
- 메인테이너 자체 플러그인 작업(#7480, #7549, #7613)도 8월에 머지 없이 닫혔다. 그 실험 브랜치의 결론은
  "첫 공개 확장 유형은 선언형으로: commands, settings, integrations, panels"였다.
- **판단:** 원본에 플러그인 시스템이 가까운 시일에 들어올 가능성은 낮다. 들어온다면 메인테이너가 설계한 선언형일 것이다.
  #33606을 따라가도 나중에 원본과 합쳐지는 이점이 없다.

### 우리 목적에 맞는지

| 우리 요구                    | #33606에서                                                                  |
| ---------------------------- | --------------------------------------------------------------------------- |
| 전역 독 (F1)                 | 슬롯이 없다. 오른쪽 패널은 스레드별이라, 우리가 피하려던 문제가 그대로 있다 |
| 사이드바 usage 위젯 (F2a)    | 사이드바 전체를 갈아끼우는 `ui.replace`만 있다. usage 데이터 API도 없다     |
| MCP 도구 (F2b, F4)           | 서버 절반에서 제공한다. 우리는 별도 MCP 서버로 원본 수정 없이 된다          |
| 원본 업데이트 따라가기 (R2)  | 원본 파일 94개를 릴리스마다 리베이스해야 한다. 정반대다                     |
| 앱을 다시 빌드하지 않고 설치 | 런타임 로딩의 가장 큰 장점이지만, 우리는 어차피 직접 빌드한다               |

### 결론: 모델은 빌리고 구현은 가져오지 않는다

가져온 아이디어

| #33606                                           | Delta에서                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| 플러그인 = 폴더 + 매니페스트                     | `delta/plugins/<id>/plugin.json`                                                  |
| `engines.t3` (호환 범위)                         | `testedUpstream` 검증 게이트                                                      |
| `@t3tools/plugin-sdk` 경계                       | `apps/web/src/delta/sdk` 파사드. 빌드할 때 연결한다                               |
| 플러그인은 혼자 실패한다                         | 슬롯마다 플러그인별 오류 경계를 두고, 실패하면 원본 화면을 유지한다               |
| `--no-plugins`                                   | `DELTA_PLUGINS=off`로 원본 그대로 빌드                                            |
| 이름 규칙 `plg_<id>_<tool>`, `plugin.<id>.<cmd>` | MCP 서버 `delta-<id>`, 커맨드 `delta.<id>.<cmd>`                                  |
| 선언형 매니페스트                                | 원본이 나중에 플러그인 시스템을 내면 옮기기 쉽게 매니페스트를 선언형으로 유지한다 |

가져오지 않은 것: 런타임 로더(`blob:` import, CSP 완화), 업로드·설치 UI, 서버 절반(서버 프로세스 안 실행,
`unhandledRejection` 감싸기), `plugins.json`·`plugins.sqlite`, 환경 선택, `ui.replace`.

비용 비교: #33606은 원본 파일 94개를 고친다. Delta 계획은 원본 파일 4개(S0, S1, S2, S4)를 각각 1~2줄 고친다.
참고로 원본 토론 #31472에서 다른 포크는 자식 프로세스·iframe 기반 호스트가 "원본 파일 25개에 약 70줄"이라고 보고했다.

## 5. 저장소와 원격

| 이름       | 주소                                        | 비고                                                             |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `origin`   | `git@github.com:kimyc3825/t3code-delta.git` | 이 포크. T3와 gh의 기본 저장소(`remote.origin.gh-resolved=base`) |
| `upstream` | `git@github.com:pingdotgg/t3code.git`       | 원본. push 비활성                                                |

- 이 PC는 github.com으로 HTTPS git 접속이 막혀 있어서 SSH를 쓴다. 이 클론의 `core.sshCommand`가
  저장소 전용 배포 키(`~/.ssh/t3code-delta_deploy`)를 지정한다.
- 원격 주소는 표준 `git@github.com:…` 형식으로 둔다. T3는 `git remote -v`로 저장소를 판별하기 때문이다.
- `gh-resolved` 표시가 없으면 T3는 `upstream`을 기본 저장소로 잡는다. 그러면 PR이 원본으로 갈 수 있다.
- GitHub 포크에는 `delta`와 `main`만 있다. 포크할 때 복사된 원본 브랜치 4,556개는 2026-11-20에 지웠다
  (모두 원본 작성자의 브랜치였다. 원본이 공개 저장소에서 지운 `sec/*` 보안 수정 브랜치 셋도 포함). 로컬 클론도
  `origin`에서 `delta`와 `main`만 받는다.
- `vp i`를 하면 원본의 pre-commit 훅(포맷, 린트, knip)이 켜진다. `delta/` 코드도 이 규칙을 따른다
  (예: `node:` 모듈은 `import * as NodeFS from "node:fs"`처럼 네임스페이스로 import, 짧은 주석).
