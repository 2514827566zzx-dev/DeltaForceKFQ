"""Import every MIDI in the user-provided Hydra archive into the local catalog."""
import argparse
import csv
import io
import json
import zipfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path, help='Hydra三角洲口琴曲库.zip')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / 'dist'
    catalog_path = root / 'assets/library.json'
    existing = json.loads(catalog_path.read_text(encoding='utf-8'))
    by_id = {song['id']: song for song in existing}
    if len(by_id) != len(existing):
        raise ValueError('Current catalog contains duplicate IDs')
    with zipfile.ZipFile(args.archive) as archive:
        rows = list(csv.DictReader(io.StringIO(archive.read('Hydra三角洲口琴曲库/曲目清单.csv').decode('utf-8-sig'))))
        for row in rows:
            ident = row['ID']
            if not ident.isascii() or not all(ch.isalnum() or ch in '_-' for ch in ident):
                raise ValueError('Invalid score ID: ' + ident)
            source = 'Hydra三角洲口琴曲库/MIDI/' + row['文件名']
            if not source.endswith('.mid'):
                raise ValueError('Unexpected score file: ' + source)
            contents = archive.read(source)
            if not contents.startswith(b'MThd') or len(contents) > 20 * 1024 * 1024:
                raise ValueError('Invalid MIDI: ' + source)
            target = root / 'assets/midi' / (ident + '.mid')
            if target.exists() and target.read_bytes() != contents:
                raise ValueError('Different MIDI already exists: ' + ident)
            target.write_bytes(contents)
            if ident not in by_id:
                song = dict(id=ident, name=row['曲名'], composer=row['作曲者'],
                            contributor=row['分享者'], source=row['原始数据地址'],
                            file='assets/midi/' + ident + '.mid',
                            expectedNotes=int(row['MIDI音符数']))
                existing.append(song)
                by_id[ident] = song
    if len(existing) != len(rows) or len(by_id) != len(rows):
        raise ValueError('Catalog does not match archive: %d vs %d' % (len(existing), len(rows)))
    catalog_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Imported all %d songs; kept the original featured songs first.' % len(existing))


if __name__ == '__main__':
    main()
