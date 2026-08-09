#!/usr/bin/env python3
"""Prepare a Markdown document for the yimengweixing Astro blog."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path


DEFAULT_REPO = Path(r"D:\vibe-coding-proj\my-website")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add Astro-compatible frontmatter and copy a Markdown document into the blog."
    )
    parser.add_argument("--source", required=True, type=Path, help="Source Markdown document")
    parser.add_argument("--repo", type=Path, help="Blog repository root")
    parser.add_argument("--title", required=True, help="Article title")
    parser.add_argument("--description", required=True, help="One-sentence article description")
    parser.add_argument("--tags", required=True, nargs="+", help="Two to five article tags")
    parser.add_argument("--date", default=date.today().isoformat(), help="Publication date (YYYY-MM-DD)")
    parser.add_argument("--updated-date", help="Optional update date (YYYY-MM-DD)")
    parser.add_argument("--slug", help="Optional destination filename without extension")
    parser.add_argument("--featured", action="store_true", help="Mark the post as featured")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing destination")
    parser.add_argument("--dry-run", action="store_true", help="Print the result without writing")
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(2)


def validate_date(value: str, field: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        fail(f"{field} must use YYYY-MM-DD: {value}")


def strip_frontmatter(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.startswith("---\n"):
        return normalized.lstrip("\ufeff")
    closing = re.search(r"^---\s*$", normalized[4:], flags=re.MULTILINE)
    if not closing:
        fail("source starts with frontmatter but has no closing --- line")
    return normalized[4 + closing.end() :].lstrip("\n")


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().lower()
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", value, flags=re.UNICODE)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:100].rstrip("-")


def yaml_string(value: str) -> str:
    return json.dumps(value.strip(), ensure_ascii=False)


def read_frontmatter_title(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8-sig")
    if not text.startswith("---"):
        return None
    match = re.search(r"^title:\s*(.+?)\s*$", text, flags=re.MULTILINE)
    if not match:
        return None
    raw = match.group(1)
    try:
        value = json.loads(raw)
        return value if isinstance(value, str) else None
    except json.JSONDecodeError:
        return raw.strip("'\"")


def build_frontmatter(args: argparse.Namespace) -> str:
    lines = [
        "---",
        f"title: {yaml_string(args.title)}",
        f"description: {yaml_string(args.description)}",
        f"pubDate: {yaml_string(validate_date(args.date, 'pubDate'))}",
    ]
    if args.updated_date:
        lines.append(f"updatedDate: {yaml_string(validate_date(args.updated_date, 'updatedDate'))}")
    lines.extend(
        [
            f"tags: {json.dumps(args.tags, ensure_ascii=False)}",
            f"featured: {'true' if args.featured else 'false'}",
            "---",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    source = args.source.expanduser().resolve()
    if not source.is_file():
        fail(f"source file does not exist: {source}")
    if source.suffix.lower() not in {".md", ".markdown"}:
        fail("source must be a Markdown file (.md or .markdown)")
    if not args.title.strip():
        fail("title cannot be empty")
    if not args.description.strip():
        fail("description cannot be empty")
    cleaned_tags = [tag.strip() for tag in args.tags]
    if any(not tag for tag in cleaned_tags):
        fail("tags cannot be empty")
    args.tags = list(dict.fromkeys(cleaned_tags))
    if not 2 <= len(args.tags) <= 5:
        fail("provide between 2 and 5 unique, non-empty tags")

    repo_value = args.repo or os.environ.get("YIMENG_BLOG_REPO") or DEFAULT_REPO
    repo = Path(repo_value).expanduser().resolve()
    content_dir = repo / "src" / "content" / "blog"
    if not (repo / "src" / "content.config.ts").is_file() or not content_dir.is_dir():
        fail(f"not a compatible blog repository: {repo}")

    slug = slugify(args.slug or args.title)
    if not slug:
        fail("could not derive a safe filename; provide --slug")
    destination = (content_dir / f"{slug}.md").resolve()
    if content_dir not in destination.parents:
        fail("destination escaped the blog content directory")
    for existing in [*content_dir.glob("*.md"), *content_dir.glob("*.mdx")]:
        if existing.resolve() != destination and read_frontmatter_title(existing) == args.title.strip():
            fail(
                "an article with the same title already exists at "
                f"{existing}; pass --slug {existing.stem!r} when intentionally updating it"
            )
    overwrite_warning = destination.exists() and not args.force
    if overwrite_warning and not args.dry_run:
        fail(f"destination already exists; review it before using --force: {destination}")

    body = strip_frontmatter(source.read_text(encoding="utf-8-sig")).rstrip() + "\n"
    output = f"{build_frontmatter(args)}\n\n{body}"
    print(f"SOURCE: {source}")
    print(f"DESTINATION: {destination}")
    print("FRONTMATTER:")
    print(build_frontmatter(args))
    if args.dry_run:
        if overwrite_warning:
            print("WARNING: destination exists; a real write would require --force")
        print("DRY RUN: no file written")
        return

    destination.write_text(output, encoding="utf-8", newline="\n")
    print(f"WROTE: {destination}")


if __name__ == "__main__":
    main()
