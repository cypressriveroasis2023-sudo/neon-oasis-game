"""Read-only validation of exact assembled synthetic proof candidate bytes."""
import hashlib,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parent.parent
manifest=json.loads((root/'recon-proof/source-manifest.json').read_text())
errors=[]
for item in manifest['files']:
 p=root/item['path']
 if not p.is_file(): errors.append(item['path']+': missing');continue
 data=p.read_bytes()
 if hashlib.sha256(data).hexdigest()!=item['sha256'] or len(data)!=item['bytes']:errors.append(item['path']+': changed')
if errors:raise SystemExit('\n'.join(errors))
print('Verified exact candidate files:',len(manifest['files']))
print('Accepted main commit:',manifest['accepted_main_commit'])
print('Accepted main tree:',manifest['accepted_main_tree'])
print('Runtime, lock-contract and helper-exposure gates remain HOLD until separately accepted and actually executed.')
