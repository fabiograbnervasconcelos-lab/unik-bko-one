import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bkoDigits,
  formatBkoPhoneDisplay,
  formatRobotPhoneDisplay,
  isAllowedBkoNumber,
  isAllowedRobotNumber,
  robotDigits,
} from "./robot-phone.ts";

test("robô CRM é 48 99645-0101 e BKO é 47 99786-0234", () => {
  assert.equal(robotDigits(), "5548996450101");
  assert.equal(bkoDigits(), "5547997860234");
  assert.equal(formatRobotPhoneDisplay(), "48 99645-0101");
  assert.equal(formatBkoPhoneDisplay(), "47 99786-0234");

  // Forma como o Baileys reporta (sem o 9) e com o 9
  assert.equal(isAllowedRobotNumber("554896450101:5@s.whatsapp.net"), true);
  assert.equal(isAllowedRobotNumber("5548996450101:5@s.whatsapp.net"), true);
  assert.equal(isAllowedRobotNumber("48996450101"), true);
  assert.equal(isAllowedRobotNumber("554797860234:23@s.whatsapp.net"), false);

  assert.equal(isAllowedBkoNumber("554797860234:23@s.whatsapp.net"), true);
  assert.equal(isAllowedBkoNumber("5547997860234"), true);
  assert.equal(isAllowedBkoNumber("47997860234"), true);
  assert.equal(isAllowedBkoNumber("554896450101:5@s.whatsapp.net"), false);
});
