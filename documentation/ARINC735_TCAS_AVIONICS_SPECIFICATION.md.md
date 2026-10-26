# ARINC 735B & RTCA DO-185B TCAS II Version 7.1 Avionics Specification

**Document Reference**: SPEC-ARINC735-TCAS-001  
**Version**: 1.0.0  
**Classification**: Commercial Avionics Engineering & Certification Guide

## 1\. System Overview

ARINC Characteristic 735B defines the form, fit, function, and electrical interfaces for the Airborne Traffic Alert and Collision Avoidance System (TCAS II) Computer and Processor. Working in strict compliance with RTCA DO-185B (Minimum Operational Performance Standards for TCAS II) and ICAO Annex 10 Volume IV, the TCAS II system provides automated mid-air collision avoidance protection for commercial transport airliners and business aviation aircraft worldwide.

## 2\. Core Operational Capabilities

1. **Surveillance & Tracking**: Interrogates Mode A/C and Mode S transponders at 1030 MHz using directional electron-steered antenna arrays; receives and tracks 1090 MHz transponder replies with whisper-shout multi-level attenuation.  
2. **Tau Collision Geometry**: Computes range tau (\$	au \= \-r / \\dot{r}\$) and DMOD-modified tau to predict time to closest point of approach (CPA).  
3. **TCAS II Version 7.1 Mandate**: Enforces the ICAO Annex 10 Version 7.1 standard featuring "Level Off, Level Off" vertical guidance to prevent altitude overshoot during corrective maneuvers.  
4. **Air-to-Air Mode S Coordination**: Automatically interrogates conflicting aircraft via Mode S coordination words (UF=16) to establish complementary opposite vertical senses (CLIMB vs DESCEND).  
5. **ARINC 429 Digital Telemetry**: Enforces Bit 32 odd parity across Labels 015, 016, 130, 270, 274, and 350\.