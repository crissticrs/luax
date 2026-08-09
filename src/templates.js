// src/templates.js — project starter templates
// Extracted from monolithic index.html

const TEMPLATES = {
    empty: {
        name: "Empty",
        files: {
            "main.lua": `-- Empty project
function _update(dt)
end

function _draw()
    gfx.cls("#000")
    gfx.text("Hello LuaDeck!", 40, 80, "#fff", "20px sans-serif")
end`
        }
    }
};
// NOTE: truncated in this test - full content will follow in next call if needed
