import { expect, test } from 'bun:test'
import {
  isUnlocked,
  needsLicensePrompt,
  PURCHASE_URL,
  REDEEM_URL,
  shouldAskForLicense,
  sitePage,
} from './licenseGate'
import { windowsInstallerUrl } from './download'

test('desktop can open without a hard license wall', () => {
  expect(needsLicensePrompt(false, { tier: 'free' })).toBe(false)
  expect(needsLicensePrompt(true, null)).toBe(false)
  expect(needsLicensePrompt(true, { tier: 'free' })).toBe(false)
  expect(needsLicensePrompt(true, { tier: 'trial' })).toBe(false)
  expect(needsLicensePrompt(true, { tier: 'unlock' })).toBe(false)
  expect(PURCHASE_URL).toBe('https://annotated.click/buy')
  expect(REDEEM_URL).toBe('https://annotated.click/redeem')
})

test('trial and unlock both count as unlocked; free asks for a key on paid actions', () => {
  expect(isUnlocked({ tier: 'unlock' })).toBe(true)
  expect(isUnlocked({ tier: 'trial' })).toBe(true)
  expect(isUnlocked({ tier: 'free' })).toBe(false)
  expect(shouldAskForLicense(true, { tier: 'free' })).toBe(true)
  expect(shouldAskForLicense(true, { tier: 'trial' })).toBe(false)
  expect(shouldAskForLicense(true, { tier: 'unlock' })).toBe(false)
  expect(shouldAskForLicense(false, { tier: 'free' })).toBe(false)
})

test('buy and account are site pages, and the installer link stays on github unless overridden', () => {
  expect(sitePage('/buy')).toBe('buy')
  expect(sitePage('/account')).toBe('account')
  expect(sitePage('/account/done')).toBe('account')
  expect(sitePage('/privacy')).toBe('privacy')
  expect(sitePage('/terms')).toBe('terms')
  expect(sitePage('/')).toBeNull()
  expect(windowsInstallerUrl('')).toBe('https://github.com/keithsimkin/crunchcall/releases/latest')
  expect(windowsInstallerUrl('https://annotated.click/annotated-setup.exe')).toBe(
    'https://annotated.click/annotated-setup.exe',
  )
  expect(windowsInstallerUrl('http://example.com/setup.exe')).toBe(
    'https://github.com/keithsimkin/crunchcall/releases/latest',
  )
})
