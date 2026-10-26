/**
 * ARINC735Forge Pro (v1.0.0) - Core TCAS II Version 7.1 Protocol & Signal Processing Engine
 * Implements ARINC Characteristic 735B, RTCA DO-185B, and ICAO Annex 10 Vol IV
 */

class ARINC735Engine {
  constructor() {
    // ARINC 429 Labels in Octal
    this.LABELS = {
      ALT_RANGE_LIMIT: 0o015,
      INTRUDER_RECORD: 0o016,
      INTRUDER_BEARING: 0o130,
      DISCRETE_STATUS: 0o270,
      RA_BROADCAST: 0o274,
      BITE_FAULT: 0o350
    };

    // Sensitivity Levels (SL 2 to 7) per RTCA DO-185B Table 2-11
    this.SENSITIVITY_TABLE = {
      2: { altMin: 0, altMax: 1000, tauTA: 20, tauRA: null, dmodTA: 0.30, dmodRA: null, zthrTA: 600, zthrRA: null, alim: null },
      3: { altMin: 1000, altMax: 2350, tauTA: 25, tauRA: 15, dmodTA: 0.33, dmodRA: 0.20, zthrTA: 600, zthrRA: 300, alim: 300 },
      4: { altMin: 2350, altMax: 5000, tauTA: 30, tauRA: 20, dmodTA: 0.48, dmodRA: 0.35, zthrTA: 600, zthrRA: 300, alim: 300 },
      5: { altMin: 5000, altMax: 10000, tauTA: 40, tauRA: 25, dmodTA: 0.75, dmodRA: 0.55, zthrTA: 600, zthrRA: 350, alim: 350 },
      6: { altMin: 10000, altMax: 20000, tauTA: 45, tauRA: 30, dmodTA: 1.00, dmodRA: 0.80, zthrTA: 600, zthrRA: 400, alim: 400 },
      7: { altMin: 20000, altMax: 42000, tauTA: 48, tauRA: 35, dmodTA: 1.30, dmodRA: 1.10, zthrTA: 700, zthrRA: 600, alim: 600 },
      8: { altMin: 42000, altMax: 60000, tauTA: 48, tauRA: 35, dmodTA: 1.30, dmodRA: 1.10, zthrTA: 800, zthrRA: 700, alim: 700 }
    };

    this.ownship = {
      altitude_ft: 32000,
      vertical_rate_fpm: 0,
      heading_deg: 90,
      ground_speed_kts: 450,
      radio_alt_ft: 2500,
      mode: 'TA_RA', // 'STANDBY', 'TA_ONLY', 'TA_RA'
      systemStatus: 'NORMAL'
    };

    this.intruders = [];
  }

  /**
   * Determine Sensitivity Level based on Ownship Altitude
   */
  getSensitivityLevel(altFt, radioAltFt) {
    if (this.ownship.mode === 'STANDBY') return 1;
    if (this.ownship.mode === 'TA_ONLY' || (radioAltFt !== null && radioAltFt < 1000)) {
      return 2; // TA Only below 1000ft AGL
    }
    if (altFt <= 2350) return 3;
    if (altFt <= 5000) return 4;
    if (altFt <= 10000) return 5;
    if (altFt <= 20000) return 6;
    if (altFt <= 42000) return 7;
    return 8;
  }

  /**
   * Calculate Range Tau and Modified Tau with DMOD
   * @param {number} r - Slant range in nautical miles (NM)
   * @param {number} rdot - Range rate in knots (closing speed is negative)
   * @param {number} dmod - Distance modification parameter in NM
   */
  calculateTau(r, rdot, dmod) {
    if (rdot >= 0) return Infinity; // Opening or constant distance
    const rdot_nmpsec = Math.abs(rdot) / 3600.0; // convert knots to NM/sec
    if (rdot_nmpsec < 0.0001) return Infinity;

    // Standard Tau = r / closing_speed
    const tauStd = r / rdot_nmpsec;

    // Modified Tau per RTCA DO-185B: (r^2 - DMOD^2) / (r * rdot)
    if (dmod && r > dmod) {
      const tauMod = (r * r - dmod * dmod) / (r * rdot_nmpsec);
      return Math.max(0, tauMod);
    }
    return Math.max(0, tauStd);
  }

  /**
   * Classify Intruder Threat State
   */
  classifyThreat(intruder) {
    const sl = this.getSensitivityLevel(this.ownship.altitude_ft, this.ownship.radio_alt_ft);
    const slParams = this.SENSITIVITY_TABLE[sl] || this.SENSITIVITY_TABLE[7];

    const altDiff = Math.abs(intruder.altitude_ft - this.ownship.altitude_ft);
    const closingSpeedKts = (intruder.range_rate_kts < 0) ? Math.abs(intruder.range_rate_kts) : 0;
    
    // Evaluate Tau for RA and TA
    const tauRA = slParams.tauRA ? this.calculateTau(intruder.range_nm, intruder.range_rate_kts, slParams.dmodRA) : Infinity;
    const tauTA = this.calculateTau(intruder.range_nm, intruder.range_rate_kts, slParams.dmodTA);

    let threatLevel = 'OTHER';
    let auralAlert = null;
    let raType = null;
    let raSense = null;

    // Resolution Advisory Check
    if (slParams.tauRA && tauRA <= slParams.tauRA && altDiff <= slParams.zthrRA) {
      threatLevel = 'RESOLUTION_ADVISORY';
      
      // Determine Vertical Sense (Climb vs Descend)
      if (intruder.altitude_ft >= this.ownship.altitude_ft) {
        raSense = 'DESCEND';
        raType = (this.ownship.vertical_rate_fpm >= -1500) ? 'CORRECTIVE' : 'PREVENTIVE';
        auralAlert = (raType === 'CORRECTIVE') ? 'DESCEND, DESCEND' : 'MONITOR VERTICAL SPEED';
      } else {
        raSense = 'CLIMB';
        raType = (this.ownship.vertical_rate_fpm <= 1500) ? 'CORRECTIVE' : 'PREVENTIVE';
        auralAlert = (raType === 'CORRECTIVE') ? 'CLIMB, CLIMB' : 'MONITOR VERTICAL SPEED';
      }

      // Check Version 7.1 "Level Off" condition
      if (altDiff > slParams.alim && Math.abs(this.ownship.vertical_rate_fpm) >= 1500) {
        auralAlert = 'LEVEL OFF, LEVEL OFF';
        raSense = 'LEVEL_OFF';
      }

      // Check Reversal Condition
      if (intruder.maneuverConflict) {
        raSense = (raSense === 'CLIMB') ? 'DESCEND' : 'CLIMB';
        auralAlert = (raSense === 'CLIMB') ? 'CLIMB, CLIMB NOW' : 'DESCEND, DESCEND NOW';
      }
    } 
    // Traffic Advisory Check
    else if (tauTA <= slParams.tauTA && altDiff <= slParams.zthrTA) {
      threatLevel = 'TRAFFIC_ADVISORY';
      auralAlert = 'TRAFFIC, TRAFFIC';
    } 
    // Proximate Traffic Check (within 6.0 NM and +/-1200 ft)
    else if (intruder.range_nm <= 6.0 && altDiff <= 1200) {
      threatLevel = 'PROXIMATE';
    }

    return {
      threatLevel,
      tauTA: Math.round(tauTA),
      tauRA: Math.round(tauRA),
      altDiff: Math.round(altDiff),
      auralAlert,
      raType,
      raSense,
      sensitivityLevel: sl
    };
  }

  /**
   * ARINC 429 Bit 32 Odd Parity Calculator
   */
  calculateParity(word31Bits) {
    let count = 0;
    let temp = word31Bits & 0x7FFFFFFF;
    while (temp) {
      count += temp & 1;
      temp >>= 1;
    }
    return (count % 2 === 0) ? 1 : 0;
  }

  /**
   * Reverse 8-bit octal label to ARINC 429 transmission order
   */
  reverseLabelBits(octalLabel) {
    let rev = 0;
    for (let i = 0; i < 8; i++) {
      rev = (rev << 1) | ((octalLabel >> i) & 1);
    }
    return rev;
  }

  /**
   * Encode 32-bit ARINC 429 Word with Bit 32 Odd Parity
   */
  encodeWord(octalLabel, sdi, dataBits, ssm) {
    const revLabel = this.reverseLabelBits(octalLabel) & 0xFF;
    const sdiField = (sdi & 0x03) << 8;
    const dataField = (dataBits & 0x7FFFF) << 10;
    const ssmField = (ssm & 0x03) << 29;

    let word = revLabel | sdiField | dataField | ssmField;
    const parity = this.calculateParity(word);
    word |= (parity << 31);
    return word >>> 0; // unsigned 32-bit integer
  }

  /**
   * Decode 32-bit ARINC 429 Word
   */
  decodeWord(word32) {
    const parity = (word32 >>> 31) & 1;
    const wordWithoutParity = word32 & 0x7FFFFFFF;
    const expectedParity = this.calculateParity(wordWithoutParity);
    const parityValid = (parity === expectedParity);

    const ssm = (word32 >>> 29) & 0x03;
    const data = (word32 >>> 10) & 0x7FFFF;
    const sdi = (word32 >>> 8) & 0x03;
    const rawLabel = word32 & 0xFF;

    let octalLabel = 0;
    for (let i = 0; i < 8; i++) {
      octalLabel = (octalLabel << 1) | ((rawLabel >> i) & 1);
    }

    const ssmMap = {
      0x03: 'Normal Operation',
      0x00: 'Failure Warning',
      0x01: 'No Computed Data (NCD)',
      0x02: 'Functional Test'
    };

    return {
      word_hex: '0x' + (word32 >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      octal_label: '0' + octalLabel.toString(8).padStart(3, '0'),
      sdi,
      data,
      ssm,
      ssm_meaning: ssmMap[ssm] || 'Unknown',
      parity_valid: parityValid
    };
  }

  /**
   * Generate ARINC 429 RA Broadcast Word (Label 274)
   */
  generateRABroadcastWord(raSense, raType, threatId = 1) {
    // Bits 11-13: Threat ID
    // Bit 14: Corrective (1) / Preventive (0)
    // Bit 15: Upward Sense (1) / Downward Sense (0)
    // Bit 16: Climb RA Active
    // Bit 17: Descend RA Active
    // Bit 18: Level Off Active
    // Bit 19: Reversal Active
    let payload = (threatId & 0x07);
    if (raType === 'CORRECTIVE') payload |= (1 << 3);
    if (raSense === 'CLIMB') {
      payload |= (1 << 4) | (1 << 5);
    } else if (raSense === 'DESCEND') {
      payload |= (1 << 6);
    } else if (raSense === 'LEVEL_OFF') {
      payload |= (1 << 7);
    }
    return this.encodeWord(this.LABELS.RA_BROADCAST, 0, payload, 3);
  }

  /**
   * Synthesize Air-to-Air Mode S Coordination Interrogation Word (RTCA DO-185B §2.2.4)
   */
  synthesizeCoordinationWord(ownshipSense, targetAddressHex) {
    return {
      message_type: 'UF_16_COORDINATION',
      target_address: targetAddressHex,
      interrogation_sense: ownshipSense,
      commanded_complement: (ownshipSense === 'CLIMB') ? 'DESCEND' : 'CLIMB',
      coordination_code: (ownshipSense === 'CLIMB') ? 0x01 : 0x02,
      timestamp: new Date().toISOString()
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ARINC755Engine: ARINC735Engine, ARINC735Engine };
}
