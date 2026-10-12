import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CustomSelect} from '../../../src/components/custom-select';
import {Toast,deferRemoval,toast} from '../../../src/lib/notifications';

function Fixture(){
 const [first,setFirst]=useState('b'),[second,setSecond]=useState('a'),[removed,setRemoved]=useState(false),[commits,setCommits]=useState(0);
 const options=[{value:'a',label:'Alpha'},{value:'b',label:'Beta'},{value:'c',label:'Gamma'}];
 return <main><h1>Component QA</h1><CustomSelect id="first-select" label="First Choice" value={first} onChange={setFirst} options={options}/><CustomSelect id="second-select" label="Second Choice" value={second} onChange={setSecond} options={options}/><button id="outside">Outside</button><button id="remove" onClick={()=>deferRemoval('fixture','Fixture',()=>setRemoved(true),()=>setRemoved(false),async()=>setCommits(x=>x+1))}>Remove Fixture</button><button id="notice" onClick={()=>toast('Unrelated success')}>Unrelated Toast</button><output id="remove-state">{removed?'removed':'present'} / {commits}</output><Toast/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
