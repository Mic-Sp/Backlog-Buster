/* Live QA: creates an isolated account, exercises real actions, and deletes its fixtures.
   Run with a local dev server, DATABASE_URL, and Playwright available. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createHash, createHmac, randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path:path.join(root,'.env'),quiet:true });
const { neonConfig } = require('@neondatabase/serverless');neonConfig.webSocketConstructor=require('ws');
const { PrismaNeon }=require('@prisma/adapter-neon'),{PrismaClient}=require('../src/generated/prisma/client.ts');
let chromium;try { ({chromium}=require('playwright')); } catch { ({chromium}=require(process.env.PLAYWRIGHT_MODULE || '/tmp/q-split-browser/node_modules/playwright')); }
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:process.env.DATABASE_URL})});
const base=process.env.SAFE_ROOM_BASE_URL||'http://localhost:3000',out=process.env.SAFE_ROOM_ARTIFACTS||'/tmp/backlog-safe-room-structural';
const checks=[],errors=[];let browser,player,page;
async function persisted(work, predicate) {for(let n=0;n<100;n++){const value=await work();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Persisted result did not match');}
async function audit(label) {
  const metrics=await page.evaluate(()=>{
    const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node,bad=[];
    while((node=walker.nextNode())){if(!node.parentElement||!visible(node.parentElement)||node.parentElement.closest('option,script,style,nextjs-portal'))continue;if(/01\s*\/\s*NEW ENTRY|02\s*\/\s*LIBRARY|DATA SHARDS|NETRUNNER|NIGHT CITY|CORTEX|NEURAL NET/.test(node.textContent))bad.push(node.textContent.trim());}
    const neon=[];for(const el of document.querySelectorAll('main *,[role="dialog"] *')){if(!visible(el))continue;const s=getComputedStyle(el);if(['Top','Right','Bottom','Left'].some(side=>parseFloat(s[`border${side}Width`])>0&&s[`border${side}Style`]!=='none'&&['rgb(0, 240, 255)','rgb(252, 238, 10)','rgb(5, 255, 161)'].includes(s[`border${side}Color`])))neon.push(el.className?.baseVal??el.className);}
    return {overflow:document.documentElement.scrollWidth>innerWidth,bad,neon};
  });
  assert.equal(metrics.overflow,false,`${label}: horizontal overflow`);assert.deepEqual(metrics.bad,[],`${label}: leftover copy`);assert.deepEqual(metrics.neon,[],`${label}: leftover neon borders`);checks.push(label);
}
async function main(){
  try {
    fs.mkdirSync(out,{recursive:true});
    const nonce=randomBytes(5).toString('hex');player=await prisma.player.create({data:{email:`safe-room-${nonce}@example.invalid`,passwordHash:'qa-fixture-only',handle:`safe-room-${nonce}`,operatorName:'Jill / Field Operative',tagline:'Keep a ribbon. Keep going.',avatarUrl:'preset:kitsune',preferredLayoutMode:'biohazard'}});
    const titles=[['Resident Evil',304240],['Resident Evil 0',339340],['Resident Evil 2',883710],['Resident Evil 3',952060],['Silent Hill 2',2124490],['Signalis',1262350],['Crow Country',1996010],['Tormented Souls',1367590]];
    const games=[];for(const [index,[title,app]] of titles.entries())games.push(await prisma.game.create({data:{userId:player.id,title,platform:index===4?'PS5':'PC',genre:'Survival Horror',franchise:title.startsWith('Resident Evil')?'Resident Evil':null,chronologicalOrder:index+1,releaseYear:2020,status:index===7?'Completed':index===6?'Playing':'Backlog',pinnedOrder:index===0?1:null,lengthHours:10+index,hoursPlayed:index===7?12:index===6?3:0,rating:index===7?5:null,playthroughCount:index===7?1:0,earnedXp:index===7?360:0,ownershipType:'Digital',coverUrl:`https://cdn.cloudflare.steamstatic.com/steam/apps/${app}/library_600x900.jpg`,steamAchievementsTotal:20,steamAchievementsUnlocked:index===7?20:3}}));
    const secret=process.env.AUTH_SECRET?Buffer.from(process.env.AUTH_SECRET):Buffer.from((await prisma.authSecret.findUniqueOrThrow({where:{id:'session-signing-v1'}})).value,'hex');
    const token=randomBytes(32).toString('base64url'),payload=`v1.${token}`;
    await prisma.playerSession.create({data:{userId:player.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
    browser=await chromium.launch({headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:process.env.LD_LIBRARY_PATH||'/tmp/q-split-browser/libs/usr/lib/x86_64-linux-gnu'}});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'bb_session_v1',value:`${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});await page.locator('.bio-inventory-grid').waitFor({timeout:120000});
    await page.getByRole('combobox',{name:'UI theme'}).selectOption('cyberpunk');await page.locator('[data-library-layout="cyberpunk"]').waitFor();assert.equal(await page.locator('.bio-inventory-grid').count(),0);await page.screenshot({path:`${out}/cyberpunk-comparison-1440.png`,fullPage:true});
    await page.getByRole('combobox',{name:'UI theme'}).selectOption('fantasy');await page.locator('.fantasy-inventory-grid').waitFor();assert.equal(await page.locator('.bio-inventory-grid').count(),0);
    await page.getByRole('combobox',{name:'UI theme'}).selectOption('biohazard');await page.locator('.bio-inventory-grid').waitFor();await persisted(()=>prisma.player.findUnique({where:{id:player.id}}),p=>p.preferredLayoutMode==='biohazard');checks.push('Three separate renderers and account persistence');
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===1440?1000:844});
      const mode=name=>page.getByRole('navigation',{name:'Safe Room subscreens'}).getByRole('button',{name,exact:true});
      await mode('ITEM BOX').click();await page.getByRole('group',{name:'Library status'}).getByRole('button',{name:/^Stored/}).click();
      assert.equal(await page.locator('.workspace-section-toggle:visible').count(),0);
      assert.equal(await page.locator('.library-inventory-panel').count(),0);
      assert.equal(await page.locator('.bio-inventory-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width===1440?4:2);
      assert.equal(await page.locator('.bio-box-split').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width===1440?2:1);
      await page.getByRole('button',{name:'Examine Resident Evil 2',exact:true}).click();await page.locator('.bio-examination h3').filter({hasText:'Resident Evil 2'}).waitFor();
      if(width===390)assert(await page.locator('.bio-status-deck').evaluate(el=>el.getBoundingClientRect().height<850),'Mobile status deck must remain compact');
      await audit(`${width}px: structural Item Box, examination and clean borders`);await page.screenshot({path:`${out}/item-box-${width}.png`,fullPage:true});
      await page.getByRole('searchbox',{name:'Search inventory'}).fill('Signalis');assert.equal(await page.locator('.bio-inventory-slot').count(),1);await page.getByRole('searchbox',{name:'Search inventory'}).fill('');
      await page.getByRole('button',{name:'Examine Resident Evil 2',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);assert.equal(await page.locator('.bio-inventory-slot:focus').count(),1);
      await mode('EQUIPPED / QUICK SLOTS').click();await audit(`${width}px: quick slots and active games`);await page.screenshot({path:`${out}/equipped-${width}.png`,fullPage:true});
      await mode('FILES & LOGS').click();await page.getByRole('combobox',{name:'Filter by saga'}).selectOption({label:'Resident Evil · 0/4'});await audit(`${width}px: manila folders, saga binder and records`);await page.screenshot({path:`${out}/files-${width}.png`,fullPage:true});
      await mode('ITEM BOX').click();await page.getByRole('button',{name:'Full inventory',exact:true}).click();await page.getByRole('button',{name:'Examine Resident Evil 2',exact:true}).click();await page.getByRole('button',{name:'EXAMINE / EDIT',exact:true}).click();await page.locator('form[data-game-editor-id]').getByLabel('Field notes').fill(`Safe Room journal ${width}`);await page.getByRole('button',{name:'SAVE FIELD RECORD',exact:true}).click();await persisted(()=>prisma.game.findUnique({where:{id:games[2].id}}),g=>g.notes===`Safe Room journal ${width}`);await audit(`${width}px: typewriter journal save`);await page.screenshot({path:`${out}/typewriter-${width}.png`,fullPage:true});
      await mode('FIELD RECON / RADAR').click();await audit(`${width}px: field recon composition`);await page.getByRole('button',{name:/OPEN OUTBREAK RADAR/}).click();await page.getByRole('dialog',{name:'Field Recon / Outbreak Radar'}).waitFor();await page.getByRole('tab',{name:/Outbreak Radar/}).waitFor();await audit(`${width}px: shared radar overlay`);await page.getByRole('button',{name:'Close tactical advisor',exact:true}).click();
      await page.getByRole('button',{name:'PERSONNEL FILE / TROPHIES',exact:true}).click();await page.locator('.bio-personnel-card').waitFor();await audit(`${width}px: dedicated personnel dossier`);await page.screenshot({path:`${out}/personnel-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Close personnel file',exact:true}).click();
      await page.getByRole('button',{name:/ACCOUNT SECURITY/}).click();await page.locator('.security-modal').waitFor();await audit(`${width}px: account security`);await page.getByRole('button',{name:/Close account security/i}).click();
      await page.getByRole('button',{name:'Custom Theme Studio',exact:true}).click();await page.getByRole('combobox',{name:'Base layout'}).selectOption('biohazard');await audit(`${width}px: custom theme studio`);await page.screenshot({path:`${out}/studio-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Close Custom Theme Studio',exact:true}).click();
    }
    const nav=page.getByRole('navigation',{name:'Safe Room subscreens'});
    await nav.getByRole('button',{name:'ITEM BOX',exact:true}).click();
    await page.getByRole('button',{name:'Examine Resident Evil 2',exact:true}).click();
    await page.locator('.bio-examination').getByRole('button',{name:'EQUIP',exact:true}).click();
    await persisted(()=>prisma.game.findUnique({where:{id:games[2].id}}),g=>g.pinnedOrder!==null);
    await page.locator('.bio-weapon-slot').filter({hasText:'Resident Evil 2'}).getByRole('button',{name:'STORE',exact:true}).click();
    await persisted(()=>prisma.game.findUnique({where:{id:games[2].id}}),g=>g.pinnedOrder===null);
    await page.locator('.bio-examination').getByRole('button',{name:'DEPLOY',exact:true}).click();
    await persisted(()=>prisma.game.findUnique({where:{id:games[2].id}}),g=>g.status==='Playing');
    await page.locator('.bio-storage-tabs button[aria-pressed="true"]').filter({hasText:'Deployed'}).waitFor();
    await page.getByRole('button',{name:'Examine Resident Evil 2',exact:true}).click();
    await page.getByRole('button',{name:'EXAMINE / EDIT',exact:true}).click();
    await page.getByRole('button',{name:'LOG +1H',exact:true}).click();
    await persisted(()=>prisma.game.findUnique({where:{id:games[2].id}}),g=>g.hoursPlayed===1);
    checks.push('Real equip, store, deploy and play-session actions');
    assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors,artifacts:out},null,2));
  }finally{if(page)await page.screenshot({path:`${out}/last-screen.png`,fullPage:true}).catch(()=>{});if(browser)await browser.close();if(player)await prisma.player.delete({where:{id:player.id}});await prisma.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
