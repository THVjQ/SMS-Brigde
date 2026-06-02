package com.sospos.messenger.ui.settings

import android.content.Intent
import android.os.Bundle
import android.provider.Telephony
import android.view.*
import android.widget.*
import androidx.fragment.app.Fragment
import com.google.android.material.switchmaterial.SwitchMaterial
import com.sospos.messenger.R
import com.sospos.messenger.db.ApiClient
import com.sospos.messenger.db.Prefs
import com.sospos.messenger.ui.link.LinkActivity

class SettingsFragment : Fragment() {

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, b: Bundle?): View =
        inflater.inflate(R.layout.fragment_settings, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val etServer      = view.findViewById<EditText>(R.id.etServer)
        val btnSave       = view.findViewById<Button>(R.id.btnSave)
        val btnDefault    = view.findViewById<Button>(R.id.btnSetDefault)
        val btnUnlink     = view.findViewById<Button>(R.id.btnUnlink)
        val btnPing       = view.findViewById<Button>(R.id.btnPing)
        val tvStatus      = view.findViewById<TextView>(R.id.tvStatus)
        val tvDeviceId    = view.findViewById<TextView>(R.id.tvDeviceId)
        val swForward     = view.findViewById<SwitchMaterial>(R.id.swForwardIncoming)
        val swNotify      = view.findViewById<SwitchMaterial>(R.id.swNotifyIncoming)

        etServer.setText(Prefs.serverUrl)
        tvDeviceId.text   = "Device ID: ${Prefs.deviceId}"
        swForward.isChecked = Prefs.forwardIncoming
        swNotify.isChecked  = Prefs.notifyIncoming

        btnSave.setOnClickListener {
            Prefs.serverUrl = etServer.text.toString().trim()
            Toast.makeText(requireContext(), "Saved", Toast.LENGTH_SHORT).show()
        }

        swForward.setOnCheckedChangeListener { _, v -> Prefs.forwardIncoming = v }
        swNotify.setOnCheckedChangeListener  { _, v -> Prefs.notifyIncoming  = v }

        btnPing.setOnClickListener {
            tvStatus.text = "Pinging…"
            ApiClient.ping { ok ->
                requireActivity().runOnUiThread {
                    tvStatus.text = if (ok) "✅ Server is reachable" else "❌ Can't reach server"
                }
            }
        }

        btnDefault.setOnClickListener {
            val defaultApp = Telephony.Sms.getDefaultSmsPackage(requireContext())
            if (defaultApp == requireContext().packageName) {
                Toast.makeText(requireContext(), "Already the default SMS app ✅", Toast.LENGTH_SHORT).show()
            } else {
                val i = Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT)
                i.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, requireContext().packageName)
                startActivity(i)
            }
        }

        btnUnlink.setOnClickListener {
            Prefs.isLinked = false
            startActivity(Intent(requireContext(), LinkActivity::class.java))
            requireActivity().finish()
        }
    }
}
