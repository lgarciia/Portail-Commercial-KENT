
    const paramBtn = document.getElementById("paramBtn");
    const paramDropdown = document.getElementById("paramDropdown");
    const dropdownBackdrop = document.getElementById("dropdownBackdrop");

    function closeDropdown() {
      paramDropdown.classList.remove("open");
      paramBtn.classList.remove("is-open");
      dropdownBackdrop.classList.remove("open");
      paramBtn.setAttribute("aria-expanded", "false");
    }

    function openDropdown() {
      paramDropdown.classList.add("open");
      paramBtn.classList.add("is-open");
      dropdownBackdrop.classList.add("open");
      paramBtn.setAttribute("aria-expanded", "true");
    }

    paramBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      const isOpen = paramDropdown.classList.contains("open");
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    document.addEventListener("click", function (e) {
      if (!paramDropdown.contains(e.target) && !paramBtn.contains(e.target)) {
        closeDropdown();
      }
    });

    dropdownBackdrop.addEventListener("click", function () {
      closeDropdown();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeDropdown();
      }
    });
  
