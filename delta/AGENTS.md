# T3 Code - Delta: AI 에이전트 규칙

이 저장소는 [pingdotgg/t3code](https://github.com/pingdotgg/t3code)의 개인 포크다.
루트 `AGENTS.md`의 코드 규칙(구조, Effect 사용법, 테스트, `.repos/` 참고 방법)은 그대로 따른다.
다만 루트 `AGENTS.md`의 PR·이슈·릴리스 절차는 원본 저장소용이라 이 포크에는 적용하지 않는다.
아래 규칙이 우선한다.

1. **먼저 확인:** `node delta/scripts/delta.mjs status`로 기준 원본과 현재 상태를 본다.
2. **먼저 읽기:** [ARCHITECTURE.md](ARCHITECTURE.md)(원본 추적·플러그인 구조), [SPEC.md](SPEC.md)(기능 명세),
   [LOCAL_PATCHES.md](LOCAL_PATCHES.md)(원본 수정 목록).
3. **새 코드 위치:** `delta/` 또는 `apps/web/src/delta/`에만 둔다.
4. **플러그인 import:** `apps/web/src/delta/plugins/**`는 원본 코드를 `apps/web/src/delta/sdk/`를 통해서만 import한다.
   원본이 바뀌면 sdk 한 곳만 고치기 위해서다.
5. **원본 파일 수정:** `delta.json`과 LOCAL_PATCHES.md에 등록된 seam만 고친다. 새 seam이 필요하면 먼저 사용자에게 묻고,
   등록한 다음 고친다. 고친 줄에는 `[delta-seam:<ID>]` 주석을 단다.
6. **커밋:** 메시지는 `pending(#N): …`, `seam(Sx): …`, `delta: …` 세 종류 중 하나다. 한 커밋에 섞지 않는다.
   스택 순서는 기준 태그부터 pending → seam → delta다.
7. **커밋 전:** `node delta/scripts/delta.mjs check`가 통과해야 한다. `vp i`를 한 클론에서는 원본 pre-commit 훅
   (포맷, 린트, knip)도 통과해야 한다. 훅을 건너뛰지(`--no-verify`) 않는다.
8. **원본 저장소 금지:** pingdotgg/t3code로 push, PR, 이슈, 코멘트를 하지 않는다. 사용자가 명시적으로 요청한 경우만 예외다.
9. **공개 저장소:** 토큰, 전략, 거래 데이터, 대화 내용을 커밋하지 않는다. `delta/private/`(git 제외)에 둔다.
10. **원본 내부 코드 사용:** 타입 검사가 깨짐을 잡을 수 있게 명시적으로 import한다.
    `any` 캐스팅이나 런타임 탐색으로 우회하지 않는다.
11. **원본 업데이트:** 손으로 리베이스하지 말고 `node delta/scripts/delta.mjs sync`를 쓴다. 충돌 해결은
    LOCAL_PATCHES.md 절차를 따른다. push는 사용자가 확인한 뒤에 한다.
12. **빌드:** `APP_VERSION=$(node delta/scripts/delta.mjs version)`을 넘긴다. 빠뜨리면 원본 이름과 이전 버전이 보인다.
    공식 앱과 앱 ID가 같으므로, 사용자가 요청하기 전에는 빌드한 설치 파일을 실행하지 않는다.
13. **git 원격:** 이 PC는 github.com HTTPS git이 막혀 있어 SSH를 쓴다. 이 클론의 `core.sshCommand`가 배포 키를
    지정하므로 원격 주소는 `git@github.com:…` 그대로 둔다. 별칭으로 바꾸면 T3가 GitHub 저장소로 인식하지 못한다.
