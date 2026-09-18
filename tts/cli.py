from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.table import Table

from . import settings as settings_module
from .audio_io import write_wav
from .batch import parse_script, run_batch
from .engine import Engine
from .voices import ALL_VOICE_CODES, load_voice_map

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Supertonic 3 TTS — 로컬 음성 합성 + 자막 + 발음사전 + 표현 태그",
)
console = Console()


@app.command()
def synth(
    text: str = typer.Argument(..., help="합성할 텍스트. 표현 태그 <laugh> 등을 문장 안에 넣을 수 있습니다"),
    voice: str = typer.Option("F2", "--voice", "-v", help=f"보이스 코드. {', '.join(ALL_VOICE_CODES)}"),
    out: Path = typer.Option(Path("synth.wav"), "--out", "-o", help="출력 wav 경로"),
    speed: float = typer.Option(1.00, "--speed", help="발화 속도 (0.7~2.0)"),
    total_step: int = typer.Option(8, "--total-step", help="디노이징 스텝 5~12 (높을수록 품질↑/시간↑)"),
    lang: str = typer.Option("ko", "--lang", help="언어 코드 (31종 + na=언어 무관). `supertonic-tts langs` 로 확인"),
):
    """한 문장을 합성해 wav로 저장."""
    async def _run():
        engine = await Engine.get()
        with console.status(f"[bold]합성 중 ({voice}, {engine.providers[0]})..."):
            wav = await engine.synth(text, voice_code=voice, lang=lang, total_step=total_step, speed=speed)
        write_wav(out, wav, engine.sample_rate)
        console.print(f"[green]저장됨[/green] {out}  (sr={engine.sample_rate}Hz, samples={len(wav)})")

    asyncio.run(_run())


@app.command()
def batch(
    script_path: Path = typer.Argument(..., exists=True, dir_okay=False, help="ch{NN}_script.json 경로"),
    chapter: str = typer.Option(None, "--chapter", help="챕터 ID 강제 지정 (예: 05)"),
    output_root: Path = typer.Option(None, "--output-root", help="기본은 ./workspace"),
    voice_override: str = typer.Option(None, "--voice-override", help="모든 scene을 이 보이스로 강제"),
    speed: float = typer.Option(None, "--speed"),
    total_step: int = typer.Option(None, "--total-step"),
):
    """script JSON을 받아 챕터의 모든 scene을 합성."""
    raw = script_path.read_bytes()
    script = parse_script(raw)

    async def _run():
        engine = await Engine.get()
        s = settings_module.load()
        vmap = load_voice_map(s.voice_map_path)

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task_id = progress.add_task(f"[cyan]합성 중 ({engine.providers[0]})", total=len(script.scenes))

            async def cb(completed: int, total: int, current: int | None):
                progress.update(task_id, completed=completed, description=f"[cyan]scene {current}/{total}")

            result = await run_batch(
                engine=engine,
                voice_map=vmap,
                script=script,
                chapter_id_explicit=chapter,
                filename_hint=script_path.name,
                output_root=output_root,
                voice_override=voice_override,
                speed=speed,
                total_step=total_step,
                on_progress=cb,
            )

        console.print(f"[green]완료[/green] ch{result.chapter_id}: {len(result.files)}개 파일 → {result.output_dir}")
        if result.warnings:
            console.print("[yellow]경고:[/yellow]")
            for w in result.warnings:
                console.print(f"  - {w}")

    asyncio.run(_run())


@app.command()
def voices():
    """사용 가능한 보이스와 voice_map.yaml 내용을 출력."""
    s = settings_module.load()
    vmap = load_voice_map(s.voice_map_path)

    t = Table(title="Voices (Supertonic)")
    t.add_column("Code")
    t.add_column("Gender")
    t.add_column("Default", justify="center")
    for code in ALL_VOICE_CODES:
        gender = "male" if code.startswith("M") else "female"
        is_default = "✔" if code == vmap.default else ""
        t.add_row(code, gender, is_default)
    console.print(t)

    m = Table(title=f"voice_map.yaml ({s.voice_map_path})")
    m.add_column("voice_style")
    m.add_column("→")
    m.add_column("voice code")
    m.add_row("(default)", "→", vmap.default)
    for k, v in sorted(vmap.styles.items()):
        m.add_row(k, "→", v)
    console.print(m)


@app.command()
def langs() -> None:
    """지원 언어 31종 + 언어 무관 모드(na)를 출력."""
    from .langs import ALL_LANGS

    table = Table(title="지원 언어 (Supertonic 3)")
    table.add_column("코드", style="bold")
    table.add_column("한국어")
    table.add_column("English")
    for code, ko, en in ALL_LANGS:
        table.add_row(code, ko, en)
    console.print(table)
    console.print("[dim]na 는 언어를 지정하지 않는 모드입니다 (여러 언어가 섞인 문장).[/dim]")


@app.command()
def tags() -> None:
    """표현 태그 10종과 청취 검증 상태를 출력."""
    from . import settings as _s
    from .tags import EXPRESSION_TAGS, SOURCE_OFFICIAL

    verdicts: dict[str, str] = {}
    path = _s.load().expression_tags_path
    if path.exists():
        try:
            import yaml as _yaml
            verdicts = ((_yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("verified") or {})
        except Exception:
            pass

    table = Table(title="표현 태그 (expression tags)")
    table.add_column("태그", style="bold")
    table.add_column("이름")
    table.add_column("효과")
    table.add_column("출처")
    table.add_column("검증")
    for t in EXPRESSION_TAGS:
        official = t.source == SOURCE_OFFICIAL
        table.add_row(
            t.tag, t.name, t.effect,
            "[green]공식[/green]" if official else "[yellow]커뮤니티[/yellow]",
            str(verdicts.get(t.tag, t.verified)),
        )
    console.print(table)
    console.print(
        "[dim]공식 문서는 태그가 10개라고만 밝히고 3개만 이름을 공개했습니다. "
        "나머지 7개는 커뮤니티 출처이며 개수만 공식과 일치합니다. "
        "모르는 태그는 에러 없이 조용히 글자로 읽히므로, 웹 UI의 '표현 태그 실험실'에서 "
        "직접 들어보고 판정하세요.[/dim]"
    )


@app.command()
def doctor():
    """assets/, GPU 가용성, 더미 합성 테스트."""
    s = settings_module.load()
    console.print(f"[bold]project_root[/bold]      {s.project_root}")
    console.print(f"[bold]onnx_dir[/bold]          {s.onnx_dir}")
    console.print(f"[bold]voice_styles_dir[/bold]  {s.voice_styles_dir}")
    console.print(f"[bold]workspace_root[/bold]    {s.workspace_root}")
    console.print(f"[bold]use_gpu_mode[/bold]      {s.use_gpu_mode}")

    try:
        import onnxruntime as ort
        console.print(f"[bold]onnxruntime[/bold]       {ort.__version__}")
        console.print(f"[bold]ort.get_device()[/bold]  {ort.get_device()}")
        console.print(f"[bold]available providers[/bold] {ort.get_available_providers()}")
    except Exception as e:
        console.print(f"[red]onnxruntime import 실패:[/red] {e}")
        raise typer.Exit(1)

    use_gpu = s.resolve_use_gpu()
    console.print(f"[bold]resolved use_gpu[/bold]  {use_gpu}")

    async def _smoke():
        engine = await Engine.get()
        console.print(f"[bold]engine.providers[/bold] {engine.providers}")
        # "GPU 빌드를 깔았다"와 "GPU 로 돈다"는 다르다. CUDA 런타임 DLL 이 없으면
        # 프로바이더 목록에는 남아 있어도 실제로는 CPU 로 떨어진다. 여기서 못 박아
        # 알려주지 않으면 사용자는 GPU 로 도는 줄 안다.
        if engine.use_gpu_active:
            console.print("[bold]실행 장치[/bold]         [green]GPU[/green]")
        elif use_gpu:
            console.print(
                "[bold]실행 장치[/bold]         [yellow]CPU[/yellow] "
                "(GPU 를 요청했지만 쓸 수 없어 CPU 로 실행합니다)"
            )
            console.print(
                "[dim]  onnxruntime-gpu 가 요구하는 CUDA/cuDNN 런타임이 없거나 "
                "버전이 안 맞습니다.[/dim]"
            )
            console.print(
                "[dim]  Supertonic 3 는 CPU 에서도 실시간보다 빠르니 "
                "그대로 쓰셔도 됩니다.[/dim]"
            )
            console.print(
                "[dim]  이 안내를 없애려면  set SUPERTONIC_USE_GPU=0  후 실행하세요.[/dim]"
            )
        else:
            console.print("[bold]실행 장치[/bold]         CPU")
        console.print(f"[bold]sample_rate[/bold]      {engine.sample_rate}Hz")
        with console.status("[bold]더미 합성 테스트 (F2)..."):
            import time as _t
            t0 = _t.perf_counter()
            wav = await engine.synth("안녕하세요. 테스트입니다.", voice_code="F2")
            elapsed = _t.perf_counter() - t0
        dur = len(wav) / engine.sample_rate
        console.print(
            f"[green]더미 합성 성공[/green] {dur:.2f}초 오디오를 {elapsed:.2f}초에 생성 "
            f"(실시간 대비 {dur / elapsed:.2f}배)"
        )

    try:
        asyncio.run(_smoke())
    except Exception as e:
        console.print(f"[red]doctor 실패:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def serve(
    host: str = typer.Option(None, "--host"),
    port: int = typer.Option(None, "--port"),
):
    """FastAPI 웹 서버 실행 (localhost + LAN)."""
    import uvicorn
    s = settings_module.load()
    h = host or s.host
    p = port or s.port
    console.print(f"[bold]Supertonic 3 TTS[/bold] → http://{h}:{p}  (Ctrl+C로 종료)")
    if h == "0.0.0.0":
        console.print("  본인:    http://localhost:%d" % p)
        console.print("  팀원:    http://<your-LAN-ip>:%d  (방화벽 Private 허용 필요)" % p)
    uvicorn.run(
        "supertonic_tts.server.app:create_app",
        host=h,
        port=p,
        factory=True,
        workers=1,
        reload=False,
    )


def main(argv: list[str] | None = None) -> None:
    app(argv)


if __name__ == "__main__":
    main(sys.argv[1:])
