
import Capacitor
import MLKitTranslate

@objc(MLKitTranslate)
public class MLKitTranslate: CAPPlugin {
    private var translator: Translator?
    
    private func getTranslator() -> Translator {
        if let translator = translator {
            return translator
        }
        
        let options = TranslatorOptions(
            sourceLanguage: .arabic,
            targetLanguage: .english
        )
        translator = Translator.translator(options: options)
        return translator!
    }
    
    @objc func translateArabicToEnglish(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("Text is required")
            return
        }
        
        let translator = getTranslator()
        translator.translate(text) { translatedText, error in
            if let error = error {
                call.reject("Translation failed: \(error.localizedDescription)")
                return
            }
            
            if let translatedText = translatedText {
                call.resolve(["translatedText": translatedText])
            } else {
                call.reject("Translation returned no result")
            }
        }
    }
    
    @objc func isModelDownloaded(_ call: CAPPluginCall) {
        let translator = getTranslator()
        let conditions = ModelDownloadConditions(
            allowsCellularAccess: false,
            allowsBackgroundDownloading: true
        )
        
        translator.downloadModelIfNeeded(with: conditions) { error in
            if error == nil {
                call.resolve(["isDownloaded": true])
            } else {
                call.resolve(["isDownloaded": false])
            }
        }
    }
    
    @objc func downloadModel(_ call: CAPPluginCall) {
        let translator = getTranslator()
        let conditions = ModelDownloadConditions(
            allowsCellularAccess: false,
            allowsBackgroundDownloading: true
        )
        
        translator.downloadModelIfNeeded(with: conditions) { error in
            if let error = error {
                call.reject("Failed to download model: \(error.localizedDescription)")
            } else {
                call.resolve()
            }
        }
    }
}
