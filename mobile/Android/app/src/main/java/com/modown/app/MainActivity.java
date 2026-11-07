package com.modown.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // SOFT_INPUT_ADJUST_RESIZE 在 API 30 起被标记为过时（官方建议走 WindowInsets），
    // 但 WebView 场景下它仍是让 Chromium 收到键盘视口变化的唯一可靠开关，故保留。
    @SuppressWarnings("deprecation")
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义插件必须在 super.onCreate 之前注册（Capacitor 的桥在 super 里创建）
        registerPlugin(XmdFsPlugin.class);
        super.onCreate(savedInstanceState);

        // 大屏（平板）上系统可能把软键盘判成 adjustPan / adjustNothing：Chromium 收不到视口变化，
        // 聚焦到可编辑面时键盘根本不弹（手机小屏一直是 resize，所以只有平板出问题）。
        // AndroidManifest 里已经写死 adjustResize，这里再按代码设一次，防止被主题 / 系统覆盖。
        getWindow().setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED
        );
    }
}
