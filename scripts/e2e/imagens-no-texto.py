"""Regressão com API simulada: comentário, descrição, leitura imediata e expiração.
Requer Python com Playwright e Chrome. Inicie Vite na porta 8093 antes de executar,
ou informe E2E_BASE. Não lê sessão nem escreve dados reais.
"""
import json, uuid, zlib, struct, os, subprocess
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[2]
fixture=json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    "import {detail,row,sessaoDe} from './scripts/e2e/comum.mjs'; console.log(JSON.stringify({detail,row,session:sessaoDe()}));"
], cwd=ROOT, text=True))
task=fixture['detail']; task['id']=fixture['row']['id']; task['title']='Correção com imagem no texto'; task['description']='Texto antes do print. Texto depois do print.'
task['attachments']=[];task['comments']=[]
base=os.environ.get('E2E_BASE', 'http://127.0.0.1:8093')
# Imagem PNG de teste, sem dados reais.
def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
w,h=640,220
rows=[]
for y in range(h):
 row=bytearray()
 for x in range(w):
  color=(235,80,162) if 25<x<615 and 25<y<60 else ((100,120,160) if 35<x<400 and 95<y<112 else (30,33,44))
  row.extend(color)
 rows.append(b'\x00'+row)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
file={'name':'print.png','mimeType':'image/png','buffer':png}
legacy_png=str(uuid.uuid4());legacy_jpeg=str(uuid.uuid4());legacy_pdf=str(uuid.uuid4());legacy_zip=str(uuid.uuid4())
for id, name, mime in [(legacy_png,'Referencia.png','image/png'),(legacy_jpeg,'WhatsApp Image.jpeg','image/jpeg'),
                        (legacy_pdf,'Briefing.pdf','application/pdf'),(legacy_zip,'Entrega.zip','application/zip')]:
 task['attachments'].append({'id':id,'fileName':name,'extension':name.split('.')[-1],'contentType':mime,
  'byteSize':len(png),'uploadedBy':{'id':'a','name':'Ana'},'createdAt':'2026-08-25T17:57:00Z','expiresAt':None})
posts=[]; uploads=[]; expired=set(); signed_requests=[]
hold_uploads=False; pending_uploads=[]
def handler(route):
 req=route.request; p=urlparse(req.url).path
 if p=='/test-image.png': route.fulfill(status=200,content_type='image/png',body=png);return
 if not p.startswith('/api/'):
  if req.url.startswith(base):route.continue_()
  else:route.abort()
  return
 data={'ok':True,'notices':[],'unread':0,'total':0,'rows':[]}
 if p=='/api/auth/me':data=fixture['session']
 elif p.startswith('/api/board/tree'):data={'ok':True,'spaces':[],'companies':[]}
 elif p=='/api/team':data={'ok':True,'team':[],'me':'a'}
 elif p=='/api/catalogs':data={'ok':True,'categories':[{'id':'c1','name':'Ide','isDefault':True}],'plans':[],'tags':[]}
 elif p=='/api/board/attachments/urls':
  ids=req.post_data_json['ids']; signed_requests.extend(ids)
  data={'ok':True,'urls':{id:{'url':base+'/test-image.png?id='+id,'expiresAt':'2099-01-01T00:00:00Z'} for id in ids if id not in expired}}
 elif p.startswith('/api/board/tasks/'):
  if p.endswith('/attachments') and req.method=='POST':
   if hold_uploads:pending_uploads.append(route);return
   assert b'name="temporaria"' in req.post_data_buffer
   id=str(uuid.uuid4());uploads.append(id)
   task['attachments'].append({'id':id,'fileName':'print.png','inText':True,'extension':'png','contentType':'image/png','byteSize':len(png),'uploadedBy':{'id':'a','name':'Ana'},'createdAt':'2026-09-11T17:00:00Z','expiresAt':'2026-09-21T17:00:00Z'})
   data={'ok':True,'id':id,'task':task}
  elif p.endswith('/comments') and req.method=='POST':
   body=req.post_data_json;posts.append(body);id=str(uuid.uuid4())
   task['comments'].append({'id':id,'parentId':body.get('parentId'),'body':body['body'],'author':{'id':'a','name':'Ana'},'mine':True,'createdAt':'2026-09-11T17:00:00Z','editedAt':None,'replyCount':0,'replies':[]})
   task['progress']['commentCount']=len(task['comments']);data={'ok':True,'id':id,'task':task}
  else:
   if req.method=='PATCH':task.update(req.post_data_json)
   data={'ok':True,'task':task,'storage':{'ready':True,'variable':''}}
 elif p.startswith('/api/board/comments/') and req.method=='PATCH':
  comment=next(c for c in task['comments'] if c['id']==p.split('/')[-1]);comment['body']=req.post_data_json['body'];data={'ok':True,'task':task}
 route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
 context=browser.new_context(viewport={'width':1440,'height':1000})
 context.route('**/*',handler)
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_default_timeout(10000)
 page.goto(base+'/tarefa/'+task['id']);page.wait_for_load_state('networkidle')
 Path('/tmp/ideworks-inline-initial.html').write_text(page.content())
 page.screenshot(path='/tmp/ideworks-inline-initial.png',full_page=True)
 # Anexos antigos mostram as duas imagens ao abrir; só o PDF mantém "ver aqui".
 attachments=page.locator('.a-grade')
 expect(attachments.locator('img')).to_have_count(2)
 expect(attachments.get_by_role('button',name='ver aqui',exact=True)).to_have_count(1)
 assert legacy_png in signed_requests and legacy_jpeg in signed_requests
 assert legacy_pdf not in signed_requests and legacy_zip not in signed_requests
 jpeg_card=attachments.locator('.a-ficha').filter(has_text='WhatsApp Image.jpeg')
 expect(jpeg_card.get_by_role('img',name='WhatsApp Image.jpeg')).to_be_visible()
 jpeg_card.get_by_role('button',name='Ampliar imagem').click()
 expect(page.get_by_role('dialog',name='Imagem anexada').get_by_role('img')).to_be_visible()
 page.keyboard.press('Escape')
 page.locator('.a-secao').screenshot(path='/tmp/ideworks-attachment-previews.png')
 # Comentário: prévia vem antes de enviar; texto e imagem persistem na mesma fala.
 composer=page.locator('.c-bloco > .c-escrever')
 def transfer(files):
  return page.evaluate_handle("""files => {
   const dt = new DataTransfer();
   for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, {type:f.type}));
   return dt;
  }""", files)
 image_transfer=transfer([{'name':'print.png','type':'image/png','bytes':list(png)}])
 def drop(field, dt=None):
  if dt is None:dt=image_transfer
  field.locator('.c-caixa').dispatch_event('dragenter', {'dataTransfer':dt})
  field.locator('.c-caixa').dispatch_event('dragover', {'dataTransfer':dt})
  field.locator('.c-caixa').dispatch_event('drop', {'dataTransfer':dt})
 composer.locator('.c-caixa').fill('Ajustar o título conforme este print. ')
 # O navegador protege os arquivos antes do drop: só os tipos ficam disponíveis.
 protected_transfer=transfer([{'name':'print.png','type':'image/png','bytes':list(png)}])
 protected_transfer.evaluate("dt => Object.defineProperty(dt, 'files', {value: []})")
 composer.locator('.c-caixa').dispatch_event('dragenter', {'dataTransfer':protected_transfer})
 expect(composer.get_by_text('Solte as imagens para anexar')).to_be_visible()
 composer.screenshot(path='/tmp/ideworks-comment-drop.png')
 composer.locator('.c-caixa').dispatch_event('dragleave', {'dataTransfer':protected_transfer})
 expect(composer.get_by_text('Solte as imagens para anexar')).to_have_count(0)
 # Texto arrastado não é interceptado; um arquivo solto não navega o navegador.
 assert composer.locator('.c-caixa').evaluate("""el => {
  const dt=new DataTransfer();dt.setData('text/plain','trecho');
  const e=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});
  el.dispatchEvent(e);return !e.defaultPrevented;
 }""")
 composer.locator('.c-caixa').dispatch_event('dragenter', {'dataTransfer':image_transfer})
 assert composer.locator('.c-caixa').evaluate("""(el,dt) => {
  const e=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});
  el.dispatchEvent(e);return e.defaultPrevented;
 }""",image_transfer)
 expect(composer.locator('img')).to_be_visible()
 assert len(posts)==0
 assert composer.locator('.c-caixa').inner_text().endswith(' ')
 composer.get_by_role('button',name='Comentar',exact=True).click()
 expect(page.locator('.c-fala img')).to_be_visible()
 assert posts[0]['body'].startswith('Ajustar o título conforme este print. ')
 assert 'attachment:'+uploads[0] in posts[0]['body']
 assert page.locator('.imagens-anteriores img').count()==0
 page.locator('.c-fala').get_by_role('button',name='Ampliar imagem').click()
 expect(page.get_by_role('dialog',name='Imagem anexada').locator('img')).to_be_visible()
 page.keyboard.press('Escape')
 # Reabrir carrega sem clique.
 page.reload();page.wait_for_load_state('networkidle')
 expect(page.locator('.c-fala img')).to_be_visible()
 page.locator('.c-bloco').screenshot(path='/tmp/ideworks-inline-comment.png')
 # Descrição: posição do cursor, upload, salvamento e reabertura.
 editor=page.get_by_role('textbox',name='Descrição da tarefa',exact=True)
 editor.evaluate("el => { const t=el.querySelector('p').firstChild; const r=document.createRange();r.setStart(t,t.textContent.indexOf(' Texto depois'));r.collapse(true);const s=window.getSelection();s.removeAllRanges();s.addRange(r);el.focus(); }")
 with page.expect_file_chooser() as chooser:
  page.get_by_role('button',name='Inserir imagem',exact=True).click()
 chooser.value.set_files(file)
 expect(editor.locator('img')).to_be_visible()
 assert editor.inner_text().startswith('Texto antes do print.')
 page.locator('.cu-trilha').get_by_role('button',name='Salvar',exact=True).click()
 page.wait_for_load_state('networkidle')
 assert 'attachment:'+uploads[1] in task['description']
 assert 'http' not in task['description'] and 'test-image' not in task['description']
 assert task['description'].index('Texto antes') < task['description'].index('attachment:') < task['description'].index('Texto depois')
 page.reload();page.wait_for_load_state('networkidle');expect(editor.locator('img')).to_be_visible()
 page.locator('.cu-ficha-corpo').screenshot(path='/tmp/ideworks-inline-description.png')
 # Apenas imagem também é comentário válido.
 clip=composer.get_by_role('button',name='Anexar imagem',exact=True)
 assert clip.inner_text()==''
 with page.expect_file_chooser() as chooser:clip.click()
 chooser.value.set_files(file);expect(composer.locator('img')).to_be_visible()
 composer.get_by_role('button',name='Comentar',exact=True).click()
 expect(page.locator('.c-fala img')).to_have_count(2)
 assert posts[-1]['body'].startswith('![')
 # Depois da exclusão fica o texto, com indicação da imagem indisponível.
 expired.add(uploads[0]);page.reload();page.wait_for_load_state('networkidle')
 expect(page.locator('.c-fala').filter(has_text='Ajustar o título')).to_contain_text('Ajustar o título')
 expect(page.locator('.c-fala').filter(has_text='Ajustar o título')).to_contain_text('Imagem expirada ou indisponível.')
 # Resposta: várias imagens no mesmo gesto, recusa do arquivo inválido e texto preservado.
 image_transfer=transfer([{'name':'print.png','type':'image/png','bytes':list(png)}])
 parent=page.locator('.c-fala').filter(has_text='Ajustar o título')
 # A expiração encurta a página; rolar cancela a restauração de posição do reload.
 page.mouse.wheel(0,400)
 parent.get_by_role('button',name='Responder',exact=True).scroll_into_view_if_needed()
 parent.get_by_role('button',name='Responder',exact=True).click()
 reply=parent.locator('.c-escrever-resposta')
 reply.locator('.c-caixa').fill('Duas referências de correção.')
 batch=transfer([{'name':'primeira.png','type':'image/png','bytes':list(png)},
                 {'name':'invalida.png','type':'image/png','bytes':list(b'nao e imagem')},
                 {'name':'segunda.png','type':'image/png','bytes':list(png)}])
 before_posts=len(posts)
 drop(reply,batch)
 expect(reply.locator('img')).to_have_count(2)
 expect(page.locator('.c-bloco > .a-erro')).to_contain_text('PNG ou JPEG válida')
 assert len(posts)==before_posts
 assert reply.locator('.c-caixa').inner_text()=='Duas referências de correção.'
 reply.get_by_role('button',name='Responder',exact=True).click()
 response=page.locator('.c-respostas .c-fala').filter(has_text='Duas referências')
 expect(response.locator('.c-texto img')).to_have_count(2)
 assert posts[-1]['parentId']==task['comments'][0]['id']
 # Editar usa o mesmo gesto, salva as três imagens e mantém o texto.
 response.get_by_role('button',name='Editar',exact=True).click()
 edit=response.locator('.c-escrever-resposta')
 drop(edit)
 expect(edit.locator('img')).to_have_count(3)
 edit.get_by_role('button',name='Salvar',exact=True).click()
 expect(response.locator('.c-texto img')).to_have_count(3)
 # Um segundo drop durante upload não duplica o envio.
 hold_uploads=True;before_uploads=len(uploads)
 drop(composer)
 expect(composer.locator('.c-caixa')).to_have_attribute('contenteditable','false')
 drop(composer)
 page.wait_for_function("document.querySelector('.c-bloco > .c-escrever .c-caixa').contentEditable === 'false'")
 assert len(pending_uploads)==1
 hold_uploads=False;handler(pending_uploads.pop())
 expect(composer.locator('img')).to_have_count(1)
 expect(composer.locator('.c-caixa')).to_have_attribute('contenteditable','true')
 assert len(uploads)==before_uploads+1
 expect(composer.get_by_text('Solte as imagens para anexar')).to_have_count(0)
 # Colar print entre textos na descrição mantém a posição depois de salvar.
 editor.fill('Antes da imagem. Depois da imagem.')
 editor.evaluate("""el => {
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let t;
  while ((t=walker.nextNode()) && !t.textContent.includes('Depois')) {}
  const r=document.createRange();r.setStart(t,t.textContent.indexOf('Depois'));r.collapse(true);
  const s=window.getSelection();s.removeAllRanges();s.addRange(r);el.focus();
 }""")
 editor.evaluate("(el,dt) => el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}))",image_transfer)
 expect(editor.locator('img')).to_have_count(1)
 page.locator('.cu-trilha').get_by_role('button',name='Salvar',exact=True).click()
 page.wait_for_load_state('networkidle')
 assert task['description'].index('Antes') < task['description'].index('attachment:') < task['description'].index('Depois')
 # Uma imagem antiga indisponível mostra aviso, preservando o cartão e o download.
 expired.add(legacy_jpeg);page.reload();page.wait_for_load_state('networkidle')
 expect(jpeg_card).to_contain_text('Imagem expirada ou indisponível.')
 expect(jpeg_card.get_by_role('button',name='WhatsApp Image.jpeg',exact=True)).to_be_visible()
 expect(attachments.get_by_role('img',name='Referencia.png',exact=True)).to_be_visible()
 assert not errors,errors
 print('OK: prévias de anexos antigos, clipes, colagem entre textos, arrastar imagens, respostas, edição, arquivo inválido, bloqueio durante upload, ampliação, reabertura e expiração.',flush=True)
 browser.close()
