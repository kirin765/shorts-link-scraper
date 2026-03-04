# Shorts Link Scraper Chrome Extension

YouTube Shorts와 TikTok Shorts 자동 재생 전환 시 현재 영상 링크를 수집하는 Chrome extension 예시입니다.

## Features

- YouTube Shorts 동작 중 URL 변화를 감지해 Shorts 링크를 캡처
- TikTok Shorts/비디오 URL 변화를 감지해 Shorts 링크를 캡처
- `chrome.storage.local`에 최대 1,000건 보관
- URL 중복은 URL 기준으로 제외
- 팝업에서 최근 수집 목록 확인
- 전체 링크 복사
- CSV 다운로드 (`short_links_YYYYMMDD_HHMMSS.csv` 형식)
- 초기화 버튼으로 저장 내역 삭제

## Install

1. Chrome에서 `chrome://extensions` 열기
2. **개발자 모드** 활성화
3. **압축해제된 확장 프로그램 로드** 클릭
4. 이 폴더를 선택

## Storage

- 저장 키: `shortLinks`
- 레코드 스키마: `{ id, url, source, capturedAt }`
- `source`: `youtube` 또는 `tiktok`

## Notes

- TikTok URL 패턴은 사이트 구조 변경에 따라 정규식 보강이 필요할 수 있습니다.
- 현재 버전은 클립보드/CSV 내보내기 및 로컬 저장 위주입니다.
