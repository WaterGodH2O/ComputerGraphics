from __future__ import annotations

import sys
from pathlib import Path
from typing import List

OUTPUT_DIR_NAME = "__pdf_text"


def find_pdf_files(root: Path) -> List[Path]:
	"""
	Recursively find all .pdf files under the given root directory.
	"""
	return sorted(p for p in root.rglob("*.pdf") if p.is_file())


def ensure_output_dir(root: Path) -> Path:
	"""
	Create and return the output directory path.
	"""
	output_dir = root / OUTPUT_DIR_NAME
	output_dir.mkdir(parents=True, exist_ok=True)
	return output_dir


def extract_pdf_to_text(pdf_path: Path, output_dir: Path) -> Path:
	"""
	Extracts text from a single PDF and writes it to a .txt file in output_dir.
	Returns the created .txt file path.
	"""
	from pdfminer.high_level import extract_text  # imported here to avoid import if not needed

	target_txt = output_dir / (pdf_path.stem + ".txt")
	text = extract_text(str(pdf_path))
	# Normalize newlines for consistency
	text = text.replace("\r\n", "\n").replace("\r", "\n")
	target_txt.write_text(text, encoding="utf-8", errors="ignore")
	return target_txt


def main() -> int:
	project_root = Path.cwd()
	output_dir = ensure_output_dir(project_root)
	pdf_files = find_pdf_files(project_root)

	if not pdf_files:
		print("No PDF files found.", file=sys.stderr)
		return 0

	created_files: List[Path] = []
	for pdf_path in pdf_files:
		try:
			txt_path = extract_pdf_to_text(pdf_path, output_dir)
			created_files.append(txt_path)
			print(f"Extracted: {pdf_path} -> {txt_path}")
		except Exception as exc:  # narrow exceptions isn't critical here; we log and continue
			print(f"Failed to extract {pdf_path}: {exc}", file=sys.stderr)

	print(f"Done. Created {len(created_files)} text file(s) in {output_dir}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())


