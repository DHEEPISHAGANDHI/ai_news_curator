
async function translateText(text, targetLang) {
    if (targetLang === "en") return text; 
    try {
        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`);
        const data = await response.json();
        return data.responseData.translatedText || text;
    } catch (error) {
        console.error("Translation error:", error);
        return text;
    }
}
async function applyTranslations() {
    const targetLang = localStorage.getItem("selectedLanguage") || "en";
    const elements = document.querySelectorAll("[data-translate]");
    
    for (const element of elements) {
        const originalText = element.getAttribute("data-translate");
        const translatedText = await translateText(originalText, targetLang);
        element.innerText = translatedText;
    }
}

function setLanguage(lang) {
    localStorage.setItem("selectedLanguage", lang);
    applyTranslations(); 
}

document.addEventListener("DOMContentLoaded", applyTranslations);
