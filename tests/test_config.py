"""Exercise the schema the host actually uses to render plugin settings."""
import unittest

from maibot_sdk.config import generate_plugin_config_schema
from test_room import MODULE


class ConfigTests(unittest.TestCase):
    def test_host_settings_have_chinese_labels_and_translated_choices(self):
        schema = generate_plugin_config_schema(MODULE.RoomConfig)
        self.assertEqual(set(schema["sections"]), {"plugin", "access", "behaviour", "tools", "performance", "chat", "tv"})
        for section in schema["sections"].values():
            self.assertRegex(section["title"], r"[\u4e00-\u9fff]")
            for field in section["fields"].values():
                self.assertRegex(field["label"], r"[\u4e00-\u9fff]")
        for name in ("private_mode", "group_mode"):
            field = schema["sections"]["tools"]["fields"][name]
            self.assertEqual(field["type"], "select")
            self.assertEqual(field["choices"], ["whitelist", "blacklist"])
            for separator in (":", "."):
                self.assertEqual(field["i18n"]["zh"][f"choice{separator}whitelist"], "白名单")
                self.assertEqual(field["i18n"]["zh"][f"choice{separator}blacklist"], "黑名单")

    def test_removed_settings_do_not_change_active_configuration(self):
        config = MODULE.RoomConfig.model_validate({
            "life": {"enabled": True, "plugin_id": "unused.schedule"},
            "tools": {"private_mode": "blacklist", "private_users": ["qq:123"]},
            "performance": {"render_grace_seconds": 600},
        })
        self.assertNotIn("life", config.model_dump())
        self.assertEqual(config.tools.private_mode, "blacklist")
        self.assertEqual(config.tools.private_users, ["qq:123"])
        self.assertEqual(config.performance.render_grace_seconds, 600)


if __name__ == "__main__":
    unittest.main()
