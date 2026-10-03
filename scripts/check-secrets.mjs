import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";import {execFileSync} from "node:child_process";
const root=fileURLToPath(new URL("../",import.meta.url));process.chdir(root);
const privateNames=[".env.local",".dev.vars"];const secrets=new Set();
for(const name of privateNames){if(!fs.existsSync(name))continue;for(const line of fs.readFileSync(name,"utf8").split(/\r?\n/)){const n=line.indexOf("=");if(n<0)continue;const key=line.slice(0,n),value=line.slice(n+1).trim().replace(/^["']|["']$/g,"");if(/KEY|SECRET|ACCESS_CODE/.test(key)&&value.length>=8)secrets.add(value)}}
if(secrets.size<3)throw new Error("需要本地私密配置以执行真实密钥扫描；未读取到足够候选值。");
const targets=execFileSync("git",["ls-files","-co","--exclude-standard"],{encoding:"utf8"}).split(/\r?\n/).filter(Boolean);
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,item.name);if(item.isDirectory())walk(f);else if(item.isFile())targets.push(f)}}
if(fs.existsSync("dist"))walk("dist");
const findings=[];for(const filename of [...new Set(targets)]){if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())continue;const content=fs.readFileSync(filename);for(const value of secrets)if(content.includes(Buffer.from(value)))findings.push(filename)}
const summary={filesScanned:[...new Set(targets)].length,privateValuesChecked:secrets.size,findings:[...new Set(findings)]};console.log(JSON.stringify(summary));if(findings.length)process.exitCode=1;
