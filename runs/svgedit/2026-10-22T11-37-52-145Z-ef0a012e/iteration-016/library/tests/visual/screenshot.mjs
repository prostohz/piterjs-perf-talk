#!/usr/bin/env node
/**
 * Take screenshots of the rotation recalculation bug demo.
 * Usage: node tests/visual/screenshot.mjs
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const htmlPath = resolve(__dirname, 'rotation-recalc-demo.html')
const outputPath = resolve(__dirname, 'rotation-recalc-demo.png')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 980 } })
await page.goto(`file://${htmlPath}`)
await page.waitForTimeout(500) // let fonts render
await page.screenshot({ path: outputPath, fullPage: true })
await browser.close()

console.log(`Screenshot saved to: ${outputPath}`)
