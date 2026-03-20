#!/usr/bin/env python3

# Copyright 2026 LiveKit
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import smbus2
import time
import math

# ---------------------------
# Configuration
# ---------------------------
I2C_BUS = 7       # your working I²C bus
ADDR = 0x69       # detected WHO_AM_I address
WHO_AM_I = 0x0F
CTRL_REG1 = 0x20
CTRL_REG4 = 0x23
OUT_X_L = 0x28    # Low byte X-axis angular rate (auto-increment addresses)

# Sensitivity in dps/LSB for 2000 dps full scale
# Can be adjusted to CTRL_REG4 settings
SENSITIVITY = 70.0 / 1000  # 70 mdps/LSB

# ---------------------------
# Initialize I2C bus
# ---------------------------
bus = smbus2.SMBus(I2C_BUS)

# ---------------------------
# Check WHO_AM_I
# ---------------------------
who = bus.read_byte_data(ADDR, WHO_AM_I)
if who != 0xD3:
    raise RuntimeError(f"Unexpected WHO_AM_I value: {who:#x}")

print(f"L3G4200D detected, WHO_AM_I={who:#x}")

# ---------------------------
# Initialize the gyro
# ---------------------------
# CTRL_REG1: Data rate 95Hz, cut-off 12.5Hz, all axes enabled
bus.write_byte_data(ADDR, CTRL_REG1, 0b00001111)

# CTRL_REG4: 2000 dps full scale, little endian
bus.write_byte_data(ADDR, CTRL_REG4, 0b00100000)

time.sleep(0.1)  # allow sensor to stabilize

# ---------------------------
# Helper functions
# ---------------------------
def read_gyro():
    """Read X, Y, Z angular rates in dps."""
    # Auto-increment addresses for multiple reads: set MSB
    data = bus.read_i2c_block_data(ADDR, OUT_X_L | 0x80, 6)
    x = twos_complement(data[1] << 8 | data[0], 16) * SENSITIVITY
    y = twos_complement(data[3] << 8 | data[2], 16) * SENSITIVITY
    z = twos_complement(data[5] << 8 | data[4], 16) * SENSITIVITY
    return x, y, z

def twos_complement(val, bits):
    """Compute the 2's complement of int value val"""
    if val & (1 << (bits - 1)):
        val -= 1 << bits
    return val

# ---------------------------
# Simple pose estimation
# ---------------------------
angle_x = 0.0
angle_y = 0.0
angle_z = 0.0

prev_time = time.time()

try:
    while True:
        current_time = time.time()
        dt = current_time - prev_time
        prev_time = current_time

        gx, gy, gz = read_gyro()

        # Integrate angular rate to get approximate angles (deg)
        angle_x += gx * dt
        angle_y += gy * dt
        angle_z += gz * dt

        # Print nicely
        print(f"Gyro dps: X={gx:.2f}, Y={gy:.2f}, Z={gz:.2f} | "
              f"Angles: X={angle_x:.2f}, Y={angle_y:.2f}, Z={angle_z:.2f}")

        time.sleep(0.05)

except KeyboardInterrupt:
    print("Exiting...")
    bus.close()
