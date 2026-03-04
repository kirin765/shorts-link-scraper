# TikTok Short Link Scraper

TikTok Shorts/Video 페이지가 자동 재생으로 이동할 때 비디오 링크와 숫자 지표를 수집하는 Chrome Extension (Manifest V3).

## Features

- 대상은 TikTok만 수집합니다.
- 수집 항목
  - `url`
  - `likeCount`
  - `commentCount`
  - `bookmarkCount`
  - `shareCount`
  - `capturedAt`
- URL 중복 제거 (`url` 기준)
- 최대 1000건 저장 (`shortLinks`)
- 팝업에서 최근 수집 목록 확인
- 목록 전체 복사(CSV 형태)
- 지정 경로로 `tiktok_list.csv` 저장 갱신(폴더 기준, `downloads` API overwrite)
- 저장소 초기화

## Data format

- Storage key: `shortLinks`
- Record schema:

```json
{
  "id": "string",
  "url": "string",
  "source": "tiktok",
  "capturedAt": "2026-03-05T12:34:56.000Z",
  "likeCount": 1234,
  "commentCount": 45,
  "bookmarkCount": 6,
  "shareCount": 7
}
```

`count` 값은 페이지에서 추출되지 않으면 `null`로 저장됩니다.

## Install

1. Chrome에서 `chrome://extensions` 열기
2. **개발자 모드** ON
3. **압축해제된 확장 프로그램 로드** -> 프로젝트 루트 폴더 선택
4. TikTok 페이지 열기 (`https://www.tiktok.com/...`)

## CSV output path

- 기본 경로: `tiktok_list.csv`
- 팝업에서 `CSV 저장 경로 (다운로드 폴더 기준)` 입력 후 저장
- 경로는 상대 경로로 `videos/tiktok_list.csv` 형태 권장
- 매 수집 이벤트마다 서비스 워커에서 경로 파일을 덮어쓰기 시도(`overwrite`)

## Notes

- TikTok DOM 구조 변경 시 카운트 수집 정확도가 떨어질 수 있습니다.
- URL 추출/정규화 실패 시 `CAPTURE_LINK`가 저장되지 않습니다.
- 수동 CSV 저장 버튼은 현재 설정 경로로 즉시 내보내기를 요청합니다.

