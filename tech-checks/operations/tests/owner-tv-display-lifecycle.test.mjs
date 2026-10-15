import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as navigation from '../src/workspaceNavigation.ts';
import {primaryAreas} from '../src/visionAreas.ts';
import {createOperationsSessionRecovery,guardSessionCallback} from '../src/operationsSessionRecovery.ts';

// Execute OwnerApp's actual JSX/callback wiring and DailyBoard's actual display
// effect. The hook host supplies only state/memo semantics, not a DOM or browser.
const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const appCode=ts.transpileModule(source.replaceAll('import.meta.env.BASE_URL',"'/'"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const boardSource=readFileSync(new URL('../src/DailyBoard.tsx',import.meta.url),'utf8');
const boardAst=ts.createSourceFile('DailyBoard.tsx',boardSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let displayEffect;
function visit(node){
 if(ts.isCallExpression(node)&&node.expression.getText(boardAst)==='useEffect'&&node.arguments[0].getText(boardAst).includes('COS_TV_BOARD_DISPLAY_MODE'))displayEffect=node.arguments[0].getText(boardAst);
 ts.forEachChild(node,visit);
}
visit(boardAst);assert.ok(displayEffect,'Actual board display effect must exist');
const displayCode=ts.transpileModule('function display(tv,onTvChange){return ('+displayEffect+')();}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const owner={authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',productionOwnerUserId:'11111111-1111-4111-8111-111111111111',features:{fleetAccess:true,vrmRead:true}};
const sameDeps=(a,b)=>Boolean(a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index])));
function hookHost(){
 const slots=[];let index=0;const writes=[];
 const hooks={
  useState(initial){const key=index++;if(!slots[key])slots[key]={value:typeof initial==='function'?initial():initial,set(next){const value=typeof next==='function'?next(slots[key].value):next;if(!Object.is(value,slots[key].value)){slots[key].value=value;writes.push(key);}}};return [slots[key].value,slots[key].set];},
  useRef(initial){const key=index++;return slots[key]??=( {current:initial} );},
  useMemo(factory,deps){const key=index++;if(!sameDeps(slots[key]?.deps,deps))slots[key]={value:factory(),deps};return slots[key].value;},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},
  useEffect(){index++;},
  Fragment:'fragment',
 };
 return {hooks,writes,render(fn){index=0;return fn();}};
}
function nodes(tree,type){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,type));return [...(tree.type===type?[tree]:[]),...nodes(tree.props?.children,type)];}
async function fixture(){
 const hooks=hookHost(),messages=[],host=new URL('https://synthetic.example/tech-checks/?tvBoard=1');
 const location=new URL('https://synthetic.example/operations/dist/?tvBoard=1#daily-board');
 const history={state:null,replaceState(state,_title,value){this.state=state;if(value)location.href=new URL(value,location).href;}};
 const parent={postMessage(message,origin){assert.equal(origin,location.origin);messages.push({...message});if(message.type==='COS_TV_BOARD_DISPLAY_MODE'&&!message.active)for(const key of ['tvBoard','tvScope','tvDepartment'])host.searchParams.delete(key);}};
 const window={parent,location,dispatchEvent(){},scrollTo(){}};
 let state,invalidated;
 const controller=createOperationsSessionRecovery({read:async()=>owner,mode:()=>'',changed:next=>state=next});await controller.check();
 const sessionHook={useOperationsSession(clear){invalidated=clear;return {...state,guardCurrent:hooks.hooks.useCallback(callback=>guardSessionCallback(controller.isCurrent,state.generation,callback),[state.generation]),check:()=>controller.check()};}};
 const modules={
  react:hooks.hooks,'react/jsx-runtime':{Fragment:'fragment',jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  './useOperationsSession':sessionHook,'./api':{api:{},openLegacy(){assert.fail('No legacy navigation is expected');}},
  './workspaceNavigation':{...navigation,readWorkspaceRoute:()=>navigation.readWorkspaceRoute(location.hash)},
  './visionAreas':{primaryAreas},'./VisionAreas':{default:'VisionAreas',AreaIcon:'AreaIcon',primaryWorkspace:active=>active},
  './unitTracker':{trackerAccess:()=>false},'../../it-feature-availability':{IT_DAILY_ONLY:false},
 };
 const exports={};vm.runInNewContext(appCode,{exports,window,location,history,URLSearchParams,Date,Event,require:name=>modules[name]||{default:name.slice(2)}},{filename:'App.tsx'});
 const context={window,location,history,URL,URLSearchParams};vm.createContext(context);vm.runInContext(displayCode,context,{filename:'DailyBoard display effect'});
 let cleanup=null,lastCallback=null,lastTv=null;
 function display(callback,tv=true){if(callback===lastCallback&&tv===lastTv)return;cleanup?.();lastCallback=callback;lastTv=tv;cleanup=context.display(tv,callback);}
 function unmount(){cleanup?.();cleanup=null;lastCallback=null;lastTv=null;}
 function render(){return hooks.render(()=>{const entry=exports.default();return entry.type(entry.props);});}
 return {render,display,unmount,messages,host,location,hooks,controller,invalidate(){controller.invalidate('authentication-denied');invalidated();},callback(tree=render()){const board=nodes(tree,'DailyBoard');assert.equal(board.length,1);return board[0].props.onTvChange;}};
}

test('routine Owner shell renders preserve the TV effect and reload launch URL',async()=>{
 const f=await fixture(),callback=f.callback();f.display(callback);
 assert.deepEqual(f.messages,[{type:'COS_TV_BOARD_DISPLAY_MODE',active:true}]);
 const callbacks=[];for(let index=0;index<5;index++){const next=f.callback();callbacks.push(next);f.display(next);}
 assert.deepEqual(f.messages,[{type:'COS_TV_BOARD_DISPLAY_MODE',active:true}],'routine renders must not send a false TV exit');assert.equal(f.host.searchParams.get('tvBoard'),'1');
 assert.ok(callbacks.every(next=>next===callback),'ordinary shell state renders keep the same guarded callback');
});

test('explicit TV exit still notifies the host and removes both launch URLs',async()=>{
 const f=await fixture(),callback=f.callback();f.display(callback);f.display(callback,false);
 assert.equal(f.messages.at(-1).active,false);assert.equal(f.host.searchParams.has('tvBoard'),false);assert.equal(f.location.searchParams.has('tvBoard'),false);
 assert.equal(nodes(f.render(),'OwnerBoardControls').length,1);
});

test('actual TV unmount exits the host even though a quarantined callback cannot update shell state',async()=>{
 const f=await fixture(),callback=f.callback();f.display(callback);f.invalidate();
 assert.equal(nodes(f.render(),'DailyBoard').length,0,'quarantine unmounts the private board');
 const writes=f.hooks.writes.length;callback(true);callback(false);assert.equal(f.hooks.writes.length,writes,'retained callback remains generation-fenced');
 f.unmount();assert.deepEqual(f.messages,[{type:'COS_TV_BOARD_DISPLAY_MODE',active:true},{type:'COS_TV_BOARD_DISPLAY_MODE',active:false}]);assert.equal(f.host.searchParams.has('tvBoard'),false);
});
