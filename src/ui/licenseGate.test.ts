import { expect, test } from 'bun:test'
import { needsLicensePrompt, PURCHASE_URL, REDEEM_URL, sitePage } from './licenseGate'
import { windowsInstallerUrl } from './download'

test('the first desktop launch asks for a key only when this pc is not unlocked', () => {
  expect(needsLicensePrompt(false, { tier: 'free' })).toBe(false)
  expect(needsLicensePrompt(true, null)).toBe(false)
  expect(needsLicensePrompt(true, { tier: 'free' })).toBe(true)
  expect(needsLicensePrompt(true, { tier: 'unlock' })).toBe(false)
  expect(PURCHASE_URL).toBe('https://annotated.click/buy')
  expect(REDEEM_URL).toBe('https://annotated.click/redeem')
})

test('buy and account are site pages, and the installer link stays on github unless overridden', () => {
  expect(sitePage('/buy')).toBe('buy')
  expect(sitePage('/account')).toBe('account')
  expect(sitePage('/account/done')).toBe('account')
  expect(sitePage('/')).toBeNull()
  expect(windowsInstallerUrl('')).toBe('https://github.com/keithsimkin/crunchcall/releases/latest')
  expect(windowsInstallerUrl('https://annotated.click/annotated-setup.exe')).toBe('https://annotated.click/annotated-setup.exe')
  expect(windowsInstallerUrl('http://example.com/setup.exe')).toBe('https://github.com/keithsimkin/crunchcall/releases/latest')
})
