# TrailTrip Demo v7

## 1) 카카오맵 키 넣기
`config.js`에 `kakaoJavascriptKey`를 넣으세요.

## 2) 서버 저장을 원하면
- Supabase 프로젝트 생성
- `supabase_setup.sql` 실행
- `config.js`에 `supabaseUrl`, `supabaseAnonKey` 입력

## 3) Vercel 재배포
현재 GitHub 저장소에 이 파일들로 덮어쓴 뒤 push 하면 Vercel이 자동 재배포합니다.

## 4) 모바일 현장 테스트 권장 순서
1. 지도 로딩 확인
2. 로그 시작
3. 포인트 사진/메모 기록
4. GPX 업로드 확인
5. JSON 저장 또는 서버 동기화
