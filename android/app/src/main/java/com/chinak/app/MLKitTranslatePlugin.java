
package com.chinak.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;

@CapacitorPlugin(name = "MLKitTranslate")
public class MLKitTranslatePlugin extends Plugin {

    private Translator translator = null;

    private Translator getTranslator() {
        if (translator == null) {
            TranslatorOptions options =
                    new TranslatorOptions.Builder()
                            .setSourceLanguage(TranslateLanguage.ARABIC)
                            .setTargetLanguage(TranslateLanguage.ENGLISH)
                            .build();
            translator = Translation.getClient(options);
        }
        return translator;
    }

    @PluginMethod
    public void translateArabicToEnglish(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("Text is required");
            return;
        }

        Translator translator = getTranslator();
        translator.translate(text)
                .addOnSuccessListener(translatedText -> {
                    JSObject ret = new JSObject();
                    ret.put("translatedText", translatedText);
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> {
                    call.reject("Translation failed: " + e.getMessage());
                });
    }

    @PluginMethod
    public void isModelDownloaded(PluginCall call) {
        Translator translator = getTranslator();
        translator.downloadModelIfNeeded()
                .addOnSuccessListener(aVoid -> {
                    JSObject ret = new JSObject();
                    ret.put("isDownloaded", true);
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> {
                    JSObject ret = new JSObject();
                    ret.put("isDownloaded", false);
                    call.resolve(ret);
                });
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        Translator translator = getTranslator();
        DownloadConditions conditions = new DownloadConditions.Builder()
                .requireWifi()
                .build();

        translator.downloadModelIfNeeded(conditions)
                .addOnSuccessListener(aVoid -> {
                    call.resolve();
                })
                .addOnFailureListener(e -> {
                    call.reject("Failed to download model: " + e.getMessage());
                });
    }
}
