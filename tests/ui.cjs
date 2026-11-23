// Requires Playwright with Chromium. Run from the repository root.
const {chromium}=require('playwright'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'zang-beta-'));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:950},acceptDownloads:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(require('node:url').pathToFileURL(path.resolve('Zang-Pitch-Correction-AI.html')).href);
    const click=async id=>{await page.locator('#'+id).click();await page.waitForFunction(()=>!document.body.classList.contains('working'));};
    await click('demo');assert.equal(await page.locator('.track').count(),3);
    await click('tune');await click('align');
    const h=await page.evaluate(()=>hits.find(h=>h.i===0&&h.ni===0));
    const rect=await page.locator('canvas').boundingBox();
    await page.mouse.move(rect.x+h.x+h.w*.5,rect.y+h.y);
    await page.mouse.down();await page.mouse.move(rect.x+h.x+h.w*.5,rect.y+h.y-15,{steps:4});await page.mouse.up();
    assert.ok(await page.locator('#noteLabel').textContent()!=='Select a vocal note');
    const pitch=await page.evaluate(()=>note().pitch);
    await click('undo');await click('redo');assert.equal(await page.evaluate(()=>tracks[0].notes[0].pitch),pitch);
    await page.selectOption('#view','overlay');await click('play');assert.equal(await page.locator('#play').textContent(),'Ⅱ Pause');
    await click('ab');await click('play');
    const file=async(id,name)=>{
      const wait=page.waitForEvent('download');await click(id);const d=await wait;const f=path.join(tmp,name);await d.saveAs(f);return f;
    };
    const session=await file('save','test.zpitch'), stems=await file('export','stems.zip'),wav=await file('stem','lead.wav');
    assert.ok((await fs.stat(stems)).size>100000);assert.ok((await fs.readFile(wav)).subarray(0,4).toString()==='RIFF');
    await page.locator('#projectFile').setInputFiles(session);await page.waitForFunction(()=>document.getElementById('status').textContent.includes('restored'));
    assert.equal(await page.evaluate(()=>tracks[0].notes[0].pitch),pitch);
    await page.locator('#audioFiles').setInputFiles(wav);await page.waitForFunction(()=>document.querySelectorAll('.track').length===4);
    assert.deepEqual(errors,[]);
    if(process.env.SCREENSHOT)await page.screenshot({path:process.env.SCREENSHOT});
    console.log('PASS: offline file launch, three-track demo, tuning, guide alignment, mouse editing, undo/redo, A/B playback, original-rate WAV and ZIP export, project recall and WAV import.');
  } finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
