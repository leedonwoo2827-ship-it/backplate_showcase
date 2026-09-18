@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul

echo == backplate-showcase 첫 설치 ==
echo.
echo   이 스크립트는 **이 폴더 안에서** 다 끝냅니다. 다른 프로젝트 폴더를
echo   찾아가지 않으므로 다른 팀원 자리나 여분 PC 에서도 그대로 돕니다.
echo   여러 번 눌러도 안전합니다 - 이미 있는 것은 건너뜁니다.
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [오류] Python 3.11~3.13 이 PATH 에 없습니다.
  goto :fail
)
where node >nul 2>&1
if errorlevel 1 (
  echo [오류] Node 22+ 가 PATH 에 없습니다 - HyperFrames 렌더에 필요합니다.
  goto :fail
)

echo [1/6] 콘솔 환경 (.venv-app)
if not exist ".venv-app\Scripts\python.exe" python -m venv .venv-app
if errorlevel 1 (echo [오류] venv 생성 실패 & goto :fail)
".venv-app\Scripts\python.exe" -m pip install --quiet --upgrade pip
".venv-app\Scripts\python.exe" -m pip install --quiet -e .
if errorlevel 1 (echo [오류] 의존성 설치 실패 & goto :fail)

echo [2/6] 엔진 환경 (.venv) - onnxruntime 는 콘솔과 충돌해 따로 둡니다
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 (echo [경고] 엔진 venv 생성 실패 - 음성만 빠집니다)
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
  ".venv\Scripts\python.exe" -m pip install --quiet -r requirements-engine.txt
  if errorlevel 1 echo [경고] 엔진 의존성 설치 실패 - 음성만 빠집니다
)

echo [3/6] Node 패키지 (HyperFrames + Playwright)
call npm install --silent
if errorlevel 1 (echo [오류] npm install 실패 & goto :fail)

echo [4/6] 글꼴 (Pretendard)
".venv-app\Scripts\python.exe" tools\get_fonts.py

echo [5/6] 음성 모델 (Supertonic 3, 약 396MB)
if exist "assets\onnx\vocoder.onnx" (
  echo        이미 있습니다.
) else (
  rem 같은 PC 에 이미 받아 둔 것이 있으면 복사가 빠릅니다.
  rem   set SUPERTONIC_ASSETS_SRC=D:\...\assets   를 미리 지정해 두면 그걸 씁니다.
  rem 지정이 없으면 HuggingFace 에서 내려받습니다. 경로를 코드에 박지 않는 이유는
  rem 그 경로가 이 PC 에만 있기 때문입니다.
  if defined SUPERTONIC_ASSETS_SRC (
    if exist "!SUPERTONIC_ASSETS_SRC!\onnx\vocoder.onnx" (
      echo        복사: !SUPERTONIC_ASSETS_SRC!
      robocopy "!SUPERTONIC_ASSETS_SRC!" "assets" /E /NFL /NDL /NJH /NJS /XD ".git" >nul
    )
  )
  if not exist "assets\onnx\vocoder.onnx" (
    where git-lfs >nul 2>&1
    if errorlevel 1 (
      echo        [경고] git-lfs 가 없어 모델을 받지 못했습니다.
      echo               https://git-lfs.com 설치 후 setup.bat 을 다시 실행하세요.
      echo               ^(음성만 빠지고 덱·자막·큐시트는 그대로 나옵니다^)
    ) else (
      echo        내려받는 중... 회선에 따라 몇 분 걸립니다.
      git lfs install --skip-repo >nul 2>&1
      git clone --depth 1 https://huggingface.co/Supertone/supertonic-3 assets
      if errorlevel 1 echo        [경고] 내려받기 실패 - 음성만 빠집니다.
    )
  )
)
".venv-app\Scripts\python.exe" tools\wire_tts.py

echo [6/6] 진단
".venv-app\Scripts\python.exe" tools\doctor.py
if errorlevel 1 (
  echo.
  echo 위에 ✗ 로 표시된 것을 먼저 해결하세요.
  pause
  exit /b 1
)

echo.
echo 설치가 끝났습니다. run.bat 으로 시작하세요.
echo.
echo   로그인 둘은 **사람마다 따로** 해야 합니다:
echo     claude        한 번 실행해 구독 로그인  ^(대본·지시문 작성^)
echo     codex login   한 번 실행해 ChatGPT 로그인 ^(그림 생성^)
echo.
pause
exit /b 0

:fail
echo.
echo 설치를 마치지 못했습니다. 위 메시지가 이유입니다.
pause
exit /b 1
