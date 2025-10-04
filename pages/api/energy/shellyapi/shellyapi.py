"""
Shell cloud API module, documentation:
https://shelly-api-docs.shelly.cloud/cloud-control-api/communication
"""

from typing import Optional, Union
import requests

try:
    from .validations import validate_empty_string
except ImportError:
    from validations import validate_empty_string


class ShellyApi:
    """
    Class providing methods for getting devices, their status and ids
    via API calls.
    """

    def __init__(self, host: str, token: str, timeout: int = 5) -> None:
        validate_empty_string(host, "host")
        validate_empty_string(token, "token")
        self.host: str = host
        self.token: str = token
        self.timeout: int = timeout

    def __query_status_api(self, path: str, id: Optional[str | int] = None) -> dict:
        try:
            payload = {"auth_key": self.token}

            if id:
                payload["id"] = id

            status_request = requests.post(
                f"{self.host}/device/{path}", data=payload, timeout=self.timeout
            )
            status = status_request.json()
            return status
        except (
            requests.exceptions.ConnectTimeout,
            requests.exceptions.ConnectionError,
        ):
            return {"success": False, "msg": "Request couldn't connect or timed out"}

    def __set_parameter(self, path: str, data: dict) -> dict:
        try:
            payload = {"auth_key": self.token} | data

            status_request = requests.post(
                f"{self.host}/device/{path}",
                data=payload,
                timeout=self.timeout,
            )
            status = status_request.json()
            return status
        except (
            requests.exceptions.ConnectTimeout,
            requests.exceptions.ConnectionError,
        ):
            return {"success": False, "msg": "Request couldn't connect or timed out"}

    def get_all_devices(self) -> dict:
        """Get the status of ALL devices"""
        response = self.__query_status_api("all_status")

        if response is None or response.get("success") is False:
            raise RuntimeError(f"Request failed with: {response}")

        return response

    def get_device(self, id: Union[str, int]) -> dict:
        """Get the status of ONE device"""
        response = self.__query_status_api("status", id)

        if response is None or response.get("success") is False:
            raise RuntimeError(f"Request failed with: {response}")

        return response

    def get_device_ids(self) -> list[Union[str, int]]:
        """Get the ids of all devices"""
        response = self.get_all_devices()
        devices = response.get("data", {}).get("devices_status")

        return list(devices)  # Only get the ids of the devices

    def get_active_device_ids(self) -> list[Union[str, int]]:
        """Get the ids of all active (connected) devices"""
        response = self.get_all_devices()
        
        if response is None or response.get("isok") is False:
            raise RuntimeError(f"Request failed with: {response}")
        
        devices = response.get("data", {}).get("devices_status", {})
        
        active_devices = []
        for device_id, device_data in devices.items():
            cloud_info = device_data.get("cloud", {})
            if cloud_info.get("connected", False):
                active_devices.append(device_id)
        
        return active_devices

    def plug_s_turn_on(self, channel: int, device_id: str) -> dict:
        """Turn Plug S device on"""
        response = self.__set_parameter(
            "relay/control", {"channel": channel, "id": device_id, "turn": "on"}
        )

        return response

    def plug_s_turn_off(self, channel: int, device_id: str) -> dict:
        """Turn Plug S device off"""
        response = self.__set_parameter(
            "relay/control", {"channel": channel, "id": device_id, "turn": "off"}
        )

        return response
