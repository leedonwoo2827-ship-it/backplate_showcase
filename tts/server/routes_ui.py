from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
templates = Jinja2Templates(directory=str(WEB_DIR / "templates"))

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@router.get("/dict", response_class=HTMLResponse)
async def dict_page(request: Request):
    return templates.TemplateResponse(request, "dict.html")


@router.get("/taglab", response_class=HTMLResponse)
async def taglab_page(request: Request):
    """표현 태그 실험실 - 10종을 직접 합성해 들어보고 판정을 기록하는 화면."""
    return templates.TemplateResponse(request, "taglab.html")


@router.get("/api-guide", response_class=HTMLResponse)
async def api_guide_page(request: Request):
    return templates.TemplateResponse(request, "apiguide.html")
