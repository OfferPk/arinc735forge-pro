#!/usr/bin/env python3
"""
ARINC735Forge Pro (v1.0.0) - Automated Verification & Test Suite
Validates ARINC Characteristic 735B & RTCA DO-185B compliance:
- ARINC 429 Bit 32 Odd Parity Rule
- Label bit reversal and word round-trip encoding/decoding
- Sensitivity Level (SL 2 to 7) altitude layer mapping
- Tau closing time and DMOD modified Tau formulas
- Traffic Advisory (TA) trigger thresholds
- Resolution Advisory (RA) vertical sense (CLIMB / DESCEND)
- TCAS II Version 7.1 "Level Off, Level Off" mandate
- Emergency Sense Reversal logic ("Climb/Descend NOW")
- Air-to-Air Mode S Coordination Interrogation Complement
- 10-Point Normative Airworthiness Compliance Auditor
"""

import sys
import unittest
import math
from typing import Dict, Any

# Import module functions from arinc735-cli
import importlib.util
spec = importlib.util.spec_from_file_location("arinc735_cli", "source-code/arinc735-cli.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)

class TestARINC735Engine(unittest.TestCase):

    def test_01_arinc429_odd_parity_calculation(self):
        """Test 1: Verify ARINC 429 Bit 32 Odd Parity calculation."""
        word_odd_ones = 0b00000000000000000000000000000111  # three 1s
        parity = cli.calculate_parity(word_odd_ones)
        self.assertEqual(parity, 0, "Odd number of 1s must produce parity 0")

        word_even_ones = 0b00000000000000000000000000000011  # two 1s
        parity = cli.calculate_parity(word_even_ones)
        self.assertEqual(parity, 1, "Even number of 1s must produce parity 1")

        full_word = word_even_ones | (parity << 31)
        total_ones = bin(full_word).count('1')
        self.assertEqual(total_ones % 2, 1, "Full 32-bit word must have odd parity")

    def test_02_arinc429_label_reversal(self):
        """Test 2: Verify 8-bit octal label bit reversal for ARINC 429 transmission order."""
        octal_label = 0o274  # RA Broadcast Label
        reversed_label = cli.reverse_label_bits(octal_label)
        double_reversed = cli.reverse_label_bits(reversed_label)
        self.assertEqual(double_reversed, octal_label, "Double bit reversal must equal original label")

    def test_03_arinc429_encode_decode_roundtrip(self):
        """Test 3: Verify ARINC 429 encoding, odd parity injection, and decoding roundtrip."""
        test_labels = [0o015, 0o016, 0o130, 0o270, 0o274, 0o350]
        for label in test_labels:
            encoded = cli.encode_arinc429_word(label, 0, 0x3F1A, 3)
            decoded = cli.decode_arinc429_word(encoded)
            self.assertTrue(decoded['parity_valid'], f"Parity invalid for label 0{label:03o}")
            self.assertEqual(int(decoded['octal_label'], 8), label, "Decoded label must match")
            self.assertEqual(decoded['data'], 0x3F1A, "Decoded data payload must match")
            self.assertEqual(decoded['ssm'], 3, "Decoded SSM must match")

    def test_04_sensitivity_level_mapping(self):
        """Test 4: Verify altitude layer mapping to TCAS Sensitivity Levels (SL 2 to 7)."""
        test_cases = [
            {'alt': 800, 'radio_alt': 800, 'expected_sl': 2},    # Ground / low altitude TA only
            {'alt': 1800, 'radio_alt': 1800, 'expected_sl': 3},  # SL 3 (1000 - 2350 ft)
            {'alt': 3500, 'radio_alt': 3500, 'expected_sl': 4},  # SL 4 (2350 - 5000 ft)
            {'alt': 8000, 'radio_alt': None, 'expected_sl': 5},  # SL 5 (5000 - 10000 ft)
            {'alt': 16000, 'radio_alt': None, 'expected_sl': 6}, # SL 6 (10000 - 20000 ft)
            {'alt': 35000, 'radio_alt': None, 'expected_sl': 7}, # SL 7 (20000 - 42000 ft)
        ]
        for tc in test_cases:
            sl = cli.get_sensitivity_level(tc['alt'], tc['radio_alt'])
            self.assertEqual(sl, tc['expected_sl'], f"Alt {tc['alt']} ft must map to SL {tc['expected_sl']}")

    def test_05_tau_calculation_and_dmod(self):
        """Test 5: Verify Range Tau calculation and DMOD modified Tau behavior."""
        tau = cli.calculate_tau(3.0, -360.0, None)
        self.assertAlmostEqual(tau, 30.0, places=1, msg="Tau at 3.0 NM and 360 kts must be 30.0s")

        tau_open = cli.calculate_tau(3.0, 100.0, None)
        self.assertTrue(math.isinf(tau_open), "Diverging traffic must yield Infinite Tau")

        tau_dmod = cli.calculate_tau(2.0, -360.0, 1.10)
        self.assertLess(tau_dmod, 20.0, "DMOD must modify Tau to trigger earlier alert")

    def test_06_traffic_advisory_trigger(self):
        """Test 6: Verify Traffic Advisory (TA) trigger when Tau is within TA threshold."""
        ownship = {'altitude_ft': 32000, 'vertical_rate_fpm': 0, 'radio_alt_ft': None}
        intruder = {'altitude_ft': 32400, 'range_nm': 3.5, 'range_rate_kts': -300, 'maneuver_conflict': False}
        res = cli.classify_encounter(ownship, intruder)
        self.assertEqual(res['threat_level'], 'TRAFFIC_ADVISORY')
        self.assertEqual(res['aural_alert'], 'TRAFFIC, TRAFFIC')

    def test_07_resolution_advisory_climb_descend(self):
        """Test 7: Verify Resolution Advisory (RA) vertical sense (CLIMB vs DESCEND)."""
        ownship = {'altitude_ft': 32000, 'vertical_rate_fpm': 0, 'radio_alt_ft': None}
        
        intruder_high = {'altitude_ft': 32300, 'range_nm': 1.2, 'range_rate_kts': -400, 'maneuver_conflict': False}
        res_high = cli.classify_encounter(ownship, intruder_high)
        self.assertEqual(res_high['threat_level'], 'RESOLUTION_ADVISORY')
        self.assertEqual(res_high['ra_sense'], 'DESCEND', "Intruder above ownship must trigger DESCEND RA")
        self.assertEqual(res_high['ra_type'], 'CORRECTIVE')

        intruder_low = {'altitude_ft': 31700, 'range_nm': 1.2, 'range_rate_kts': -400, 'maneuver_conflict': False}
        res_low = cli.classify_encounter(ownship, intruder_low)
        self.assertEqual(res_low['threat_level'], 'RESOLUTION_ADVISORY')
        self.assertEqual(res_low['ra_sense'], 'CLIMB', "Intruder below ownship must trigger CLIMB RA")
        self.assertEqual(res_low['ra_type'], 'CORRECTIVE')

    def test_08_tcas_v71_level_off_alert(self):
        """Test 8: Verify TCAS II Version 7.1 'Level Off, Level Off' aural mandate."""
        ownship = {'altitude_ft': 32000, 'vertical_rate_fpm': 1800, 'radio_alt_ft': None}
        intruder = {'altitude_ft': 32600, 'range_nm': 1.5, 'range_rate_kts': -350, 'maneuver_conflict': False}
        res = cli.classify_encounter(ownship, intruder)
        self.assertEqual(res['aural_alert'], 'LEVEL OFF, LEVEL OFF', "TCAS v7.1 must issue LEVEL OFF alert")
        self.assertEqual(res['ra_sense'], 'LEVEL_OFF')

    def test_09_sense_reversal_emergency(self):
        """Test 9: Verify Emergency Sense Reversal logic when intruder maneuvers contrary to RA."""
        ownship = {'altitude_ft': 32000, 'vertical_rate_fpm': 0, 'radio_alt_ft': None}
        intruder_conflict = {'altitude_ft': 32200, 'range_nm': 0.8, 'range_rate_kts': -450, 'maneuver_conflict': True}
        res = cli.classify_encounter(ownship, intruder_conflict)
        self.assertIn('NOW', res['aural_alert'], "Maneuver conflict must trigger immediate reversal RA with NOW")

    def test_10_normative_compliance_audit(self):
        """Test 10: Verify 10-point normative airworthiness compliance auditor."""
        audit_result = cli.run_compliance_audit()
        self.assertEqual(audit_result['total_rules'], 10, "Audit must contain exactly 10 normative rules")
        self.assertEqual(audit_result['passed_count'], 10, "All 10 normative airworthiness rules must pass")
        self.assertEqual(audit_result['score_percent'], 100.0, "Compliance score must be 100%")
        self.assertEqual(audit_result['certification'], 'ARINC_735B_TCAS_II_V71_AIRWORTHY_CERTIFIED')

if __name__ == '__main__':
    suite = unittest.TestLoader().loadTestsFromTestCase(TestARINC735Engine)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\nALL 10 VERIFICATION TESTS PASSED SUCCESSFULLY.")
        sys.exit(0)
    else:
        print("\nTEST FAILURES DETECTED.")
        sys.exit(1)
