#!/usr/bin/env python3
"""
SDLC PDF Exporter — Markdown → HTML → PDF
Exports project documents as professional PDFs with cover page and TOC.

Usage:
  # Export single file
  python3 export-pdf.py docs/PRD.md

  # Export all docs for current phase
  python3 export-pdf.py --phase 1

  # Export all docs and merge into one PDF
  python3 export-pdf.py --phase 2 --merge

  # Export with custom config
  python3 export-pdf.py --phase 1 --config pdf-config.json

  # Export specific files, merged
  python3 export-pdf.py docs/PRD.md docs/ARCHITECTURE.md --merge

  # Use a different theme
  python3 export-pdf.py --phase 1 --theme minimal

  # List available themes
  python3 export-pdf.py --list-themes

Requires: python3, chromium-browser (or google-chrome), markdown, pymdown-extensions
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

try:
    import markdown
    from markdown.extensions.toc import TocExtension
except ImportError:
    print("❌ Missing dependency: pip3 install markdown pymdown-extensions")
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
PDF_ASSETS = SKILL_DIR / "assets" / "pdf"
THEMES_DIR = PDF_ASSETS / "themes"
DEFAULT_CONFIG = PDF_ASSETS / "pdf-config.example.json"


def find_chromium():
    """Find chromium/chrome binary."""
    candidates = [
        "chromium-browser", "chromium", "google-chrome",
        "google-chrome-stable", "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome"
    ]
    for c in candidates:
        try:
            subprocess.run([c, "--version"], capture_output=True, timeout=5)
            return c
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return None


def load_config(config_path=None, project_root=None):
    """Load PDF config, merging project config over defaults."""
    # Start with defaults
    with open(DEFAULT_CONFIG) as f:
        config = json.load(f)

    # Look for project-level config
    if project_root:
        project_config = Path(project_root) / "pdf-config.json"
        if project_config.exists():
            with open(project_config) as f:
                project = json.load(f)
            config.update({k: v for k, v in project.items() if v is not None})

    # Override with explicit config
    if config_path and Path(config_path).exists():
        with open(config_path) as f:
            explicit = json.load(f)
        config.update({k: v for k, v in explicit.items() if v is not None})

    return config


def load_theme(theme_name, custom_css=None):
    """Load theme CSS. Falls back to default."""
    theme_file = THEMES_DIR / f"{theme_name}.css"
    if not theme_file.exists():
        print(f"⚠️  Theme '{theme_name}' not found, using default")
        theme_file = THEMES_DIR / "default.css"

    css = theme_file.read_text(encoding="utf-8")

    # Append custom CSS if provided
    if custom_css and Path(custom_css).exists():
        css += "\n/* Custom overrides */\n"
        css += Path(custom_css).read_text(encoding="utf-8")

    return css


def md_to_html(md_text):
    """Convert markdown to HTML with extensions."""
    extensions = [
        "tables",
        "fenced_code",
        "codehilite",
        "attr_list",
        "def_list",
        "footnotes",
        "md_in_html",
        TocExtension(permalink=False, toc_depth=3),
    ]
    try:
        extensions.append("pymdownx.tasklist")
        extensions.append("pymdownx.superfences")
    except Exception:
        pass

    md = markdown.Markdown(extensions=extensions)
    html = md.convert(md_text)
    toc = getattr(md, "toc", "")
    return html, toc


def extract_title(md_text):
    """Extract first H1 from markdown."""
    match = re.search(r"^#\s+(.+)$", md_text, re.MULTILINE)
    return match.group(1).strip() if match else "Untitled"


def build_cover_html(config):
    """Build cover page HTML."""
    logo_html = ""
    if config.get("logo") and Path(config["logo"]).exists():
        logo_path = Path(config["logo"]).resolve()
        logo_html = f'<img class="cover-logo" src="file://{logo_path}" style="max-width:{config.get("logo_width", "160px")}">'

    confidential_html = ""
    if config.get("confidential"):
        label = config.get("confidential_label", "CONFIDENTIAL")
        confidential_html = f'<div class="cover-confidential">{label}</div>'

    now = datetime.now().strftime("%Y-%m-%d")

    return f"""
    <div class="cover-page">
        {logo_html}
        <div class="cover-title">{config.get('project_name', 'Project')}</div>
        <div class="cover-subtitle">Technical Documentation</div>
        <div class="cover-meta">
            <strong>Company:</strong> {config.get('company_name', '')}<br>
            <strong>Version:</strong> {config.get('version', '0.1.0')}<br>
            <strong>Date:</strong> {now}<br>
        </div>
        {confidential_html}
    </div>
    """


def build_toc_html(documents):
    """Build table of contents from multiple documents."""
    toc_items = []
    for doc_title, toc_html in documents:
        toc_items.append(f'<li class="toc-h1"><a href="#{slugify(doc_title)}">{doc_title}</a></li>')
        # Parse toc_html for sub-items
        for match in re.finditer(r'<li><a[^>]*href="([^"]*)"[^>]*>([^<]*)</a>', toc_html):
            href, text = match.groups()
            indent_class = "toc-h2"
            toc_items.append(f'<li class="{indent_class}"><a href="{href}">{text}</a></li>')

    return f"""
    <div class="toc-page">
        <h2>目錄 Table of Contents</h2>
        <ul class="toc-list">
            {''.join(toc_items)}
        </ul>
    </div>
    """


def slugify(text):
    """Simple slugify for anchors."""
    return re.sub(r"[^\w\-]", "-", text.lower()).strip("-")


def build_full_html(body_html, css, config):
    """Wrap body in full HTML document."""
    lang = config.get("language", "zh-TW")
    font_family = config.get("font_family", "Noto Sans TC, sans-serif")

    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
body {{ font-family: {font_family}; }}
{css}
</style>
</head>
<body>
{body_html}
</body>
</html>"""


def html_to_pdf(html_path, pdf_path, config):
    """Convert HTML to PDF using headless Chromium.
    
    Note: Snap-packaged Chromium cannot write to dotfile paths (e.g. ~/.openclaw/).
    We detect this and use a staging directory under ~/pdf-export-staging/ then move.
    """
    chrome = find_chromium()
    if not chrome:
        print("❌ Chromium/Chrome not found. Install chromium-browser.")
        sys.exit(1)

    pdf_path = Path(pdf_path).resolve()
    html_path = str(Path(html_path).resolve())

    # Snap Chromium can't write to hidden dirs; use staging path if needed
    needs_staging = "/." in str(pdf_path)
    if needs_staging:
        staging_dir = Path.home() / "pdf-export-staging"
        staging_dir.mkdir(exist_ok=True)
        staging_pdf = staging_dir / pdf_path.name
        chrome_output = str(staging_pdf)
    else:
        chrome_output = str(pdf_path)

    args = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        f"--print-to-pdf={chrome_output}",
        "--print-to-pdf-no-header",
        "--run-all-compositor-stages-before-draw",
        f"file://{html_path}",
    ]

    result = subprocess.run(args, capture_output=True, timeout=60)
    stderr = result.stderr.decode() if result.stderr else ""

    if not Path(chrome_output).exists():
        print(f"❌ PDF generation failed (code {result.returncode}): {stderr[:500]}")
        return False

    # Move from staging to final path if needed
    if needs_staging:
        import shutil
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging_pdf), str(pdf_path))

    return pdf_path.exists()


def export_single(md_path, output_path, config, theme_css):
    """Export a single markdown file to PDF."""
    md_path = Path(md_path)
    if not md_path.exists():
        print(f"⚠️  Skipping {md_path} (not found)")
        return None

    md_text = md_path.read_text(encoding="utf-8")
    title = extract_title(md_text)
    html_body, toc = md_to_html(md_text)

    # Wrap in document header
    doc_html = f"""
    <div class="doc-header">
        <h1 id="{slugify(title)}" style="page-break-before: avoid;">{title}</h1>
        <div class="doc-meta">Source: {md_path.name} | Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
    </div>
    {html_body}
    """

    full_html = build_full_html(doc_html, theme_css, config)

    if output_path is None:
        output_path = md_path.with_suffix(".pdf")

    # Write temp HTML to staging dir (Snap Chromium can't read dotfile paths)
    staging_dir = Path.home() / "pdf-export-staging"
    staging_dir.mkdir(exist_ok=True)
    tmp_html = str(staging_dir / "export-tmp.html")
    Path(tmp_html).write_text(full_html, encoding="utf-8")

    try:
        success = html_to_pdf(tmp_html, str(output_path), config)
        if success:
            size_kb = Path(output_path).stat().st_size / 1024
            print(f"✅ {output_path} ({size_kb:.0f} KB)")
            return output_path
        return None
    finally:
        Path(tmp_html).unlink(missing_ok=True)


def export_merged(md_paths, output_path, config, theme_css):
    """Export multiple markdown files merged into one PDF."""
    documents = []  # (title, toc_html)
    all_body = []

    # Cover page
    cover = build_cover_html(config)
    all_body.append(cover)

    for md_path in md_paths:
        md_path = Path(md_path)
        if not md_path.exists():
            print(f"⚠️  Skipping {md_path} (not found)")
            continue

        md_text = md_path.read_text(encoding="utf-8")
        title = extract_title(md_text)
        html_body, toc = md_to_html(md_text)
        documents.append((title, toc))

        doc_html = f"""
        <div class="doc-header">
            <h1 id="{slugify(title)}">{title}</h1>
            <div class="doc-meta">Source: {md_path.name} | Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
        </div>
        {html_body}
        """
        all_body.append(doc_html)

    if not documents:
        print("❌ No documents to export")
        return None

    # Insert TOC after cover
    toc_html = build_toc_html(documents)
    all_body.insert(1, toc_html)

    full_html = build_full_html("\n".join(all_body), theme_css, config)

    staging_dir = Path.home() / "pdf-export-staging"
    staging_dir.mkdir(exist_ok=True)
    tmp_html = str(staging_dir / "export-tmp.html")
    Path(tmp_html).write_text(full_html, encoding="utf-8")

    try:
        success = html_to_pdf(tmp_html, str(output_path), config)
        if success:
            size_kb = Path(output_path).stat().st_size / 1024
            print(f"✅ {output_path} ({size_kb:.0f} KB)")
            print(f"   📄 {len(documents)} documents merged")
            return output_path
        return None
    finally:
        Path(tmp_html).unlink(missing_ok=True)


def list_themes():
    """List available themes."""
    print("📎 Available themes:")
    if not THEMES_DIR.exists():
        print("   (none)")
        return
    for f in sorted(THEMES_DIR.glob("*.css")):
        name = f.stem
        size = f.stat().st_size / 1024
        default = " (default)" if name == "default" else ""
        print(f"   • {name}{default} ({size:.0f} KB)")


def main():
    parser = argparse.ArgumentParser(
        description="SDLC PDF Exporter — Export project docs as professional PDFs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s docs/PRD.md                          Export single file
  %(prog)s --phase 1                             Export Phase 1 documents
  %(prog)s --phase 2 --merge                     Merge Phase 2 into one PDF
  %(prog)s --phase 1 --merge -o design-doc.pdf   Custom output name
  %(prog)s docs/PRD.md docs/ARCHITECTURE.md --merge
  %(prog)s --list-themes
  %(prog)s --phase 1 --theme minimal

Logo guidelines:
  Recommended: 400x100px PNG (transparent) or SVG
  Aspect ratio: 4:1 works best
  Set in pdf-config.json: "logo": "path/to/logo.png"
        """,
    )
    parser.add_argument("files", nargs="*", help="Markdown files to export")
    parser.add_argument("--phase", "-p", type=int, choices=[0, 1, 2, 3, 4],
                        help="Export documents for a specific SDLC phase")
    parser.add_argument("--merge", "-m", action="store_true",
                        help="Merge all files into a single PDF with cover + TOC")
    parser.add_argument("--output", "-o", help="Output path (for --merge or single file)")
    parser.add_argument("--config", "-c", help="Path to pdf-config.json")
    parser.add_argument("--theme", "-t", default="default", help="Theme name (default: default)")
    parser.add_argument("--project-root", "-r", default=".",
                        help="Project root directory (default: current dir)")
    parser.add_argument("--list-themes", action="store_true", help="List available themes")
    parser.add_argument("--output-dir", "-d", default=None,
                        help="Output directory for individual PDFs (default: same as source)")

    args = parser.parse_args()

    if args.list_themes:
        list_themes()
        return

    # Load config
    project_root = Path(args.project_root).resolve()
    config = load_config(args.config, project_root)
    theme_css = load_theme(args.theme, config.get("custom_css"))

    # Apply accent color override
    if config.get("accent_color"):
        theme_css = theme_css.replace("--accent: #2563EB;", f"--accent: {config['accent_color']};")

    # Determine files to export
    files = []
    if args.phase is not None:
        phase_key = str(args.phase)
        phase_files = config.get("phases", {}).get(phase_key, [])
        if not phase_files:
            print(f"❌ No files configured for Phase {args.phase}")
            sys.exit(1)
        files = [project_root / f for f in phase_files]
        print(f"📋 Phase {args.phase}: {len(phase_files)} documents")
    elif args.files:
        files = [Path(f) for f in args.files]
    else:
        parser.print_help()
        sys.exit(1)

    # Check what exists
    existing = [f for f in files if f.exists()]
    missing = [f for f in files if not f.exists()]
    if missing:
        for m in missing:
            print(f"⚠️  Not found: {m}")
    if not existing:
        print("❌ No files found to export")
        sys.exit(1)

    print(f"📄 Exporting {len(existing)} document(s)...")

    # Export
    if args.merge:
        output = args.output or f"{config.get('project_name', 'project').replace(' ', '-')}-Phase{args.phase or 'X'}-docs.pdf"
        output = project_root / output
        export_merged(existing, output, config, theme_css)
    else:
        out_dir = Path(args.output_dir) if args.output_dir else None
        for f in existing:
            if out_dir:
                out_path = out_dir / f.with_suffix(".pdf").name
                out_dir.mkdir(parents=True, exist_ok=True)
            elif args.output and len(existing) == 1:
                out_path = Path(args.output)
            else:
                out_path = None  # Same dir as source
            export_single(f, out_path, config, theme_css)


if __name__ == "__main__":
    main()
