// iOS shows a form accessory bar (prev/next arrows + Done) above the keyboard
// for web inputs. WKWebView exposes no API to disable it, so swap the private
// WKContentView's class for a runtime subclass whose inputAccessoryView is nil,
// the same approach as Capacitor's hideFormAccessoryBar.

use std::ffi::CString;

use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use tauri::webview::WebviewWindow;

extern "C-unwind" fn input_accessory_view_nil(_this: &AnyObject, _cmd: Sel) -> *mut AnyObject {
    std::ptr::null_mut()
}

pub fn hide_form_accessory_bar(window: &WebviewWindow<crate::BrowserEngine>) {
    let _ = window.with_webview(|webview| unsafe {
        let webview: *mut AnyObject = webview.inner().cast();
        let scroll_view: *mut AnyObject = msg_send![&*webview, scrollView];
        let subviews: *mut AnyObject = msg_send![&*scroll_view, subviews];
        let count: usize = msg_send![&*subviews, count];
        for index in 0..count {
            let subview: *mut AnyObject = msg_send![&*subviews, objectAtIndex: index];
            let class = (*subview).class();
            if !class.name().to_bytes().starts_with(b"WKContent") {
                continue;
            }
            let Ok(subclass_name) = CString::new(format!(
                "{}_NoAccessoryBar",
                class.name().to_string_lossy()
            )) else {
                continue;
            };
            let subclass = AnyClass::get(&subclass_name).unwrap_or_else(|| {
                let mut builder = ClassBuilder::new(&subclass_name, class)
                    .expect("accessory bar subclass already registered");
                builder.add_method(
                    sel!(inputAccessoryView),
                    input_accessory_view_nil as extern "C-unwind" fn(_, _) -> _,
                );
                builder.register()
            });
            AnyObject::set_class(&*subview, subclass);
        }
    });
}
