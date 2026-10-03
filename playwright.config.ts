import {defineConfig} from "@playwright/test";
import path from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH??=path.resolve(".cache/playwright");
export default defineConfig({testDir:"tests/e2e",timeout:90000,expect:{timeout:15000},fullyParallel:false,workers:1,retries:0,reporter:[["list"],["html",{open:"never"}]],outputDir:"test-results",use:{baseURL:process.env.BUDDY_BASE_URL??"http://127.0.0.1:5173",headless:true,viewport:{width:1440,height:1000},trace:"retain-on-failure",screenshot:"only-on-failure"}});
