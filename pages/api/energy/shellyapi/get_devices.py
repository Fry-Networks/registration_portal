#!/usr/bin/env python3
"""
Script to get active Shelly device IDs using the ShellyApi class.
Usage: python get_devices.py <api_url> <api_token>
"""

import sys
import json
import os

# Add the current directory to the Python path so we can import shellyapi
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from shellyapi import ShellyApi
except ImportError as e:
    print(json.dumps({"error": f"Failed to import ShellyApi: {str(e)}"}))
    sys.exit(1)

def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: python get_devices.py <api_url> <api_token>"}))
        sys.exit(1)
    
    api_url = sys.argv[1]
    api_token = sys.argv[2]
    
    try:
        # Initialize ShellyApi with the provided URL and token
        shelly = ShellyApi(api_url, api_token)
        
        # Get active device IDs
        active_devices = shelly.get_active_device_ids()
        
        # Return the result as JSON
        print(json.dumps({
            "success": True,
            "device_ids": active_devices
        }))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()